import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, chown, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { fixedPythonCapability, sqliteTestCapability } from './backupPythonRuntime.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const producer = path.join(project, 'scripts/backup_producer.py');
const bootstrap = `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("trusted_producer", sys.argv[1])
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
def reject(action):
    try:
        action()
    except Exception:
        print("REJECTED")
    else:
        raise AssertionError("unsafe operation accepted")
`;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(process.cwd(), '.backup-producer-test-'));
  await chmod(directory, 0o700);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function python(code: string, args: string[] = [], timeout = 15_000, executable = '/usr/bin/python3') {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(executable, ['-I', '-S', '-B', '-c', bootstrap + code, producer, ...args], {
      cwd: directory, timeout, maxBuffer: 64 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    }, (error, stdout, stderr) => {
      resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout, stderr });
    });
  });
}

function sqlitePython(code: string, args: string[] = []) {
  // Outside reject(): an unsupported runtime must fail the test, not masquerade as
  // rejection of malformed reference data.
  return python('b.sqlite_bounds()\n' + code, args, 15_000, sqliteTestCapability.executable);
}

async function fixture(rows: Array<[string | Buffer | null, number | string | null]> = [], schema = true) {
  const db = new Database(':memory:');
  try {
    if (schema) {
      db.exec('CREATE TABLE tactic_evidence (file_stored_name, file_size)');
      const insert = db.prepare('INSERT INTO tactic_evidence VALUES (?, ?)');
      // These deliberately affinity-free columns preserve malformed storage types.
      // Bind integral sizes as SQLite INTEGER, not better-sqlite3's JS-number REAL.
      db.transaction(() => rows.forEach(([name, size]) => insert.run(name,
        typeof size === 'number' && Number.isSafeInteger(size) ? BigInt(size) : size)))();
    } else db.exec('CREATE TABLE legacy_fixture (id INTEGER)');
    const filename = path.join(directory, 'fixture.sqlite');
    await writeFile(filename, db.serialize(), { mode: 0o600 });
    return filename;
  } finally { db.close(); }
}

describe.skipIf(!sqliteTestCapability.supported)('producer SQLite references (requires verified positive heap limit)', () => {
  it.each([
    '../outside', '/outside', 'a/b', 'a\\b', '.env', '.', '..', '-first', '_first',
    'proof\n.txt', 'proof\r.txt', 'proof\t.txt', 'proof\0hidden', 'é.txt', '', 'a'.repeat(201),
  ])('rejects unsafe reference %j before evidence access', async (name) => {
    const filename = await fixture([['valid.txt', 1], [name, 1]]);
    const result = await sqlitePython('reject(lambda: b.snapshot_references(sys.argv[2]))\n', [filename]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
  });

  it.each([null, -1, 0.5, 1073741825, '12'])('rejects malformed size %j', async (size) => {
    const filename = await fixture([['proof.txt', size]]);
    const result = await sqlitePython('reject(lambda: b.snapshot_references(sys.argv[2]))\n', [filename]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
  });

  it('rejects blobs, oversized names and more than10000 rows without returning partial references', async () => {
    for (const rows of [
      [[Buffer.alloc(4096), 1]],
      [['x'.repeat(2 * 1024 * 1024), 1]],
      Array.from({ length: 10001 }, () => ['proof.txt', 1]),
    ] as Array<Array<[string | Buffer, number]>>) {
      const filename = await fixture(rows);
      const result = await sqlitePython('reject(lambda: b.snapshot_references(sys.argv[2]))\n', [filename]);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('REJECTED');
    }
  });

  it('accepts a legacy schema, empty references and strictly valid evidence', async () => {
    for (const [rows, schema, count] of [
      [[], false, 0], [[], true, 0], [[['proof.txt', 3], [null, null]], true, 1],
    ] as Array<[Array<[string | null, number | null]>, boolean, number]>) {
      const filename = await fixture(rows, schema);
      const result = await sqlitePython('print(len(b.snapshot_references(sys.argv[2])))\n', [filename]);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(String(count));
    }
  });

  it('rejects a view masquerading as an evidence table', async () => {
    const db = new Database(':memory:');
    const filename = path.join(directory, 'view.sqlite');
    try {
      db.exec("CREATE VIEW tactic_evidence AS SELECT 'proof.txt' AS file_stored_name, 3 AS file_size");
      await writeFile(filename, db.serialize(), { mode: 0o600 });
    } finally { db.close(); }
    const result = await sqlitePython('reject(lambda: b.snapshot_references(sys.argv[2]))\n', [filename]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
  });
});

describe('producer pure validation and no-follow descriptors (no SQLite capability assumed)', () => {
  it('lists the portable kernel fixtures without claiming execution', async () => {
    const runner = path.join(project, 'server/src/__tests__/fixtures/backup_linux_runner.py');
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile('/usr/bin/python3', ['-I', '-S', '-B', runner, '--list'], {
        cwd: directory, timeout: 5000, maxBuffer: 8192, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }));
    });
    expect(result.code, result.stderr).toBe(0);
    const manifest = JSON.parse(result.stdout);
    expect(manifest.count).toBe(31);
    expect(manifest.cases).toHaveLength(31);
    expect(new Set(manifest.cases).size).toBe(31);
    expect(manifest.cases).toEqual(expect.arrayContaining(['wal-valid', 'db-swap', 'wal-swap', 'existing-db', 'evidence-symlink']));
    expect(manifest.syntheticOnly).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });

  it('reports NOT_RUN for missing fixture prerequisites, never a passing kernel result', async () => {
    const runner = path.join(project, 'server/src/__tests__/fixtures/backup_linux_runner.py');
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile('/usr/bin/python3', ['-I', '-S', '-B', runner, '--run'], {
        cwd: directory, timeout: 5000, maxBuffer: 8192, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }));
    });
    expect(result.code, result.stderr).toBe(77);
    expect(result.stdout).toContain('RUNNER_NOT_RUN passed=0 failed=0 not_run=31');
    expect(result.stdout).not.toContain('CASE_PASS');
    expect(await readdir(directory)).toEqual([]);
  });

  it.skipIf(!fixedPythonCapability.available || fixedPythonCapability.supported)(
    'fails closed at the producer heap guard on an unsupported fixed OS runtime', async () => {
      const result = await python('reject(b.sqlite_bounds)\n');
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('REJECTED');
    });

  it('validates basename grammar independently of any SQLite prerequisite', async () => {
    const result = await python(`
assert b.NAME.fullmatch("proof-1.txt")
for value in ("../outside", ".env", "a/b", "a\\\\b", "a\\n", "a\\r", "a\\0suffix", "", "x" * 201):
    assert b.NAME.fullmatch(value) is None
print("BASENAME_VALIDATION_PASS")
`);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('BASENAME_VALIDATION_PASS');
  });

  it.each(['hardlink', 'fifo', 'owner'])('rejects an unsafe live database %s', async (mode) => {
    const filename = await fixture();
    if (mode === 'hardlink') await link(filename, path.join(directory, 'second-link'));
    if (mode === 'fifo') await rm(filename);
    const result = await python(`
if sys.argv[3] == "fifo":
    os.mkfifo(sys.argv[2] + "/fixture.sqlite", 0o600)
d = b.Directory(sys.argv[2], {0, os.getuid()})
try:
    reject(lambda: b.source_entries(d.fd, "fixture.sqlite", os.getuid() + (sys.argv[3] == "owner")))
finally:
    d.close()
`, [directory, mode]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
  });

  it.each(['', '-wal', '-shm', '-journal'])('rejects a symlink at live DB/sidecar suffix %j', async (suffix) => {
    const filename = await fixture();
    const sentinel = path.join(directory, 'sentinel');
    await writeFile(sentinel, 'synthetic sentinel', { mode: 0o600 });
    if (!suffix) await rm(filename);
    await symlink(sentinel, filename + suffix);
    const result = await python(`
d = b.Directory(sys.argv[2], {0, os.getuid()})
try:
    reject(lambda: b.source_entries(d.fd, "fixture.sqlite", os.getuid()))
finally:
    d.close()
`, [directory]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic sentinel');
  });

  it('rejects symlinked parents without opening their descendants', async () => {
    await mkdir(path.join(directory, 'actual'));
    await mkdir(path.join(directory, 'actual/child'));
    await symlink(path.join(directory, 'actual'), path.join(directory, 'alias'));
    const result = await python('reject(lambda: b.Directory(sys.argv[2], {0, os.getuid()}))\n',
      [path.join(directory, 'alias/child')]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
  });

  it.each(['symlink', 'hardlink', 'fifo', 'owner', 'missing', 'wrong-size', 'changed', 'swapped', 'directory-swap', 'destination'])
  ('rejects unsafe evidence: %s, preserving the outside sentinel', async (mode) => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    await Promise.all([mkdir(source, { mode: 0o700 }), mkdir(target, { mode: 0o700 })]);
    const proof = path.join(source, 'proof.txt');
    const sentinel = path.join(directory, 'sentinel');
    await writeFile(sentinel, 'synthetic sentinel', { mode: 0o600 });
    await writeFile(proof, 'abc', { mode: 0o600 });
    if (mode === 'symlink') { await rm(proof); await symlink(sentinel, proof); }
    if (mode === 'hardlink') await link(proof, path.join(directory, 'second-link'));
    if (mode === 'missing' || mode === 'fifo') await rm(proof);
    if (mode === 'destination') await symlink(sentinel, path.join(target, 'proof.txt'));
    const result = await python(`
mode, source, target, sentinel = sys.argv[2:]
if mode == "fifo":
    os.mkfifo(source + "/proof.txt", 0o600)
s = b.Directory(source, {0, os.getuid()})
d = b.Directory(target, {0, os.getuid()})
original_read = os.read
changed = False
def changing_read(fd, size):
    global changed
    if not changed:
        changed = True
        if mode == "changed":
            with open(source + "/proof.txt", "ab") as output:
                output.write(b"x")
        elif mode == "swapped":
            os.rename(source + "/proof.txt", source + "/old.txt")
            os.symlink(sentinel, source + "/proof.txt")
    return original_read(fd, size)
if mode in ("changed", "swapped"):
    os.read = changing_read
if mode == "directory-swap":
    os.rename(source, source + "-old")
    os.symlink(target, source)
try:
    reject(lambda: b.copy_evidence(s, d.fd, "proof.txt", 4 if mode == "wrong-size" else 3,
                                  os.getuid() + 1 if mode == "owner" else os.getuid(), os.getgid()))
finally:
    os.read = original_read
    s.close()
    d.close()
`, [mode, source, target, sentinel]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic sentinel');
  });

  it('streams valid evidence through exclusive descriptors and refuses an existing destination', async () => {
    const source = path.join(directory, 'source');
    const target = path.join(directory, 'target');
    await Promise.all([mkdir(source, { mode: 0o700 }), mkdir(target, { mode: 0o700 })]);
    await writeFile(path.join(source, 'proof.txt'), 'abc', { mode: 0o600 });
    const result = await python(`
s = b.Directory(sys.argv[2], {0, os.getuid()})
d = b.Directory(sys.argv[3], {0, os.getuid()})
try:
    b.copy_evidence(s, d.fd, "proof.txt", 3, os.getuid(), os.getgid())
    reject(lambda: b.copy_evidence(s, d.fd, "proof.txt", 3, os.getuid(), os.getgid()))
finally:
    s.close()
    d.close()
`, [source, target]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('REJECTED');
    expect(await readFile(path.join(target, 'proof.txt'), 'utf8')).toBe('abc');
  });
});

describe.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0 || !fixedPythonCapability.supported)(
  'isolated kernel/WAL integration (requires Linux root and supported fixed OS Python)', () => {
  it.each(['valid', 'legacy', 'shell-two-args', 'shell-three-args', 'db-swap', 'wal-swap', 'retained-vfs-directory', 'existing-db', 'existing-evidence', 'traversal', 'missing', 'evidence-symlink'])
  ('backs up only a complete sealed snapshot: %s', async (mode) => {
    const data = path.join(directory, 'data');
    const evidence = mode === 'shell-three-args' ? path.join(directory, 'separate evidence') : path.join(data, 'evidence');
    const backups = path.join(directory, 'backups');
    await mkdir(data, { mode: 0o700 });
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    await mkdir(backups, { mode: 0o700 });
    const filename = path.join(data, 'custom.sqlite');
    const writer = new Database(filename);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      writer.exec('CREATE TABLE isolated_marker (value INTEGER); INSERT INTO isolated_marker VALUES (123)');
      if (mode !== 'legacy') {
        writer.exec("CREATE TABLE tactic_evidence (file_stored_name TEXT, file_size INTEGER); INSERT INTO tactic_evidence VALUES ('proof.txt', 3)");
        if (mode === 'traversal') writer.prepare('INSERT INTO tactic_evidence VALUES (?, ?)').run('../sentinel.sqlite', 1);
        await writeFile(path.join(evidence, 'proof.txt'), 'abc', { mode: 0o600 });
        await chown(path.join(evidence, 'proof.txt'), 65534, 65534);
      }
      for (const name of ['custom.sqlite', 'custom.sqlite-wal', 'custom.sqlite-shm']) {
        await chmod(path.join(data, name), 0o600);
        await chown(path.join(data, name), 65534, 65534);
      }
      await chown(evidence, 65534, 65534);
      await chown(data, 65534, 65534);
      expect((await readFile(filename + '-wal')).length).toBeGreaterThan(0);
      const sentinel = path.join(directory, 'sentinel.sqlite');
      await writeFile(sentinel, 'synthetic root-only sentinel', { mode: 0o600 });
      if (mode === 'missing' || mode === 'evidence-symlink') await rm(path.join(evidence, 'proof.txt'));
      if (mode === 'evidence-symlink') await symlink(sentinel, path.join(evidence, 'proof.txt'));
      const result = mode.startsWith('shell-') ? await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile('/bin/bash', [path.join(project, 'scripts/backup.sh'), data, backups,
          ...(mode === 'shell-three-args' ? [evidence] : [])], {
          cwd: directory, timeout: 110_000, maxBuffer: 64 * 1024,
          env: { PATH: '/usr/bin:/bin', DB_FILE: 'custom.sqlite' },
        }, (error, stdout, stderr) => {
          resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout, stderr });
        });
      }) : await python(`
mode, data, backups, evidence = sys.argv[2:]
original_connect = b.sqlite3.connect
def raced_connect(filename, *args, **kwargs):
    if mode in ("db-swap", "wal-swap") and isinstance(filename, str) and filename.startswith("file:/custom.sqlite?"):
        # This hook runs only AFTER the real chroot/drop, directly at the old TOCTOU gap.
        name = "/custom.sqlite" + ("-wal" if mode == "wal-swap" else "")
        os.rename(name, name + ".held")
        os.symlink("../sentinel.sqlite", name)
    return original_connect(filename, *args, **kwargs)
b.sqlite3.connect = raced_connect
if mode == "retained-vfs-directory":
    original_handles = b.verify_worker_handles
    def retained_directory(*args):
        os.open(data + "/..", b.DIR_FLAGS)
        original_handles(*args)
    b.verify_worker_handles = retained_directory
original_stamp = b.time.strftime
b.time.strftime = lambda *_args: "20260905T090000Z"
if mode == "existing-db":
    os.symlink(sys.argv[3] + "/../sentinel.sqlite", backups + "/app-20260905T090000Z.sqlite")
if mode == "existing-evidence":
    os.symlink(sys.argv[3] + "/../sentinel.sqlite", backups + "/evidence-20260905T090000Z")
try:
    if mode in ("valid", "legacy"):
        b.produce(data, backups, evidence, "custom.sqlite")
    else:
        reject(lambda: b.produce(data, backups, evidence, "custom.sqlite"))
finally:
    b.time.strftime = original_stamp
`, [mode, data, backups, evidence], 110_000);
      expect(result.code, result.stderr).toBe(0);
      expect(await readFile(sentinel, 'utf8')).toBe('synthetic root-only sentinel');
      expect((await readdir(backups)).some((name) => name.startsWith('.backup-stage-'))).toBe(false);
      if (mode === 'valid' || mode === 'legacy' || mode.startsWith('shell-')) {
        expect(result.stdout).toContain('BACKUP_PASS');
        const snapshot = (await readdir(backups)).find((name) => /^app-\d{8}T\d{6}Z\.sqlite$/.test(name));
        expect(snapshot).toBeDefined();
        const restored = new Database(path.join(backups, snapshot!), { readonly: true });
        try { expect(restored.prepare('SELECT value FROM isolated_marker').get()).toEqual({ value: 123 }); }
        finally { restored.close(); }
        if (mode !== 'legacy') {
          const copiedEvidence = snapshot!.replace(/^app-/, 'evidence-').replace(/\.sqlite$/, '');
          expect(await readFile(path.join(backups, copiedEvidence, 'proof.txt'), 'utf8')).toBe('abc');
        }
      } else {
        expect(result.stdout.trim()).toBe('REJECTED');
        expect(result.stdout).not.toContain('BACKUP_PASS');
        if (mode !== 'existing-db' && mode !== 'existing-evidence') expect(await readdir(backups)).toEqual([]);
      }
    } finally { writer.close(); }
  }, 120_000);
});
