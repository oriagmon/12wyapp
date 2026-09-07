import { afterEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { cloudBackupConfig, BLOCK_BYTES, CloudBackupError, DEFAULT_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES } from '../lib/cloudBackupConfig.js';
import { uploadSnapshotArchive, type CloudUploadProviders } from '../lib/cloudBackup.js';
import {
  validateCompletedSnapshot, readSnapshotReferences, REFERENCE_HELPER_PATH, REFERENCE_OUTPUT_BYTES,
  type SnapshotArchive, type SnapshotProviders, type ReferenceCommand,
} from '../lib/cloudBackupSnapshot.js';
import type { CloudRequest, CloudResponse } from '../lib/cloudBackupTransport.js';
import { sqliteTestCapability } from './backupPythonRuntime.js';

vi.mock('../lib/cloudBackupTransport.js', () => ({
  boundedCloudRequest: vi.fn(async () => { throw new Error('Real cloud requests forbidden in tests'); }),
}));

const NOW = new Date('2026-09-05T08:00:00.000Z');
const env = { AZURE_BACKUP_ENABLED: 'true', AZURE_BACKUP_ACCOUNT: 'fixtureaccount', AZURE_BACKUP_CONTAINER: 'private-backups' };
const response = (status: number, body: unknown = {}, headers: CloudResponse['headers'] = {}): CloudResponse => ({
  status, body: Buffer.from(JSON.stringify(body)), headers,
});
function archive(chunks: Buffer[], completion = Promise.resolve()): SnapshotArchive {
  void completion.catch(() => undefined);
  return { stream: Readable.from(chunks), completion, cancel: vi.fn() };
}
function transportFixture() {
  let size = 0;
  let metadata: Record<string, string> = {};
  const calls: CloudRequest[] = [];
  const request = vi.fn(async (input: CloudRequest): Promise<CloudResponse> => {
    calls.push(input);
    if (input.url.hostname === '169.254.169.254') return response(200, {
      token_type: 'Bearer', access_token: 'synthetic-token-value-for-tests-only', expires_on: String(NOW.getTime() / 1000 + 3600), resource: 'https://storage.azure.com/',
    });
    if (input.url.searchParams.get('comp') === 'block') {
      size += input.body!.length;
      return response(201);
    }
    if (input.url.searchParams.get('comp') === 'blocklist') {
      metadata = input.headers;
      return response(201);
    }
    return response(200, {}, {
      'content-length': String(size), 'x-ms-blob-type': 'BlockBlob',
      'x-ms-meta-sha256': metadata['x-ms-meta-sha256'],
      'x-ms-meta-backupformat': metadata['x-ms-meta-backupformat'],
    });
  });
  const providers: CloudUploadProviders = { request, now: () => NOW, uuid: () => '00000000-0000-4000-8000-000000000001', sleep: vi.fn(async () => undefined) };
  return { request, calls, providers };
}

describe('opt-in cloud backup configuration', () => {
  it('uses public Azure Blob names, bounded archive sizes and no keys', () => {
    expect(cloudBackupConfig(env)).toMatchObject({ maxArchiveBytes: DEFAULT_ARCHIVE_BYTES });
    expect(cloudBackupConfig({ ...env, AZURE_BACKUP_MAX_BYTES: String(MAX_ARCHIVE_BYTES) }).maxArchiveBytes).toBe(MAX_ARCHIVE_BYTES);
    for (const override of [
      { AZURE_BACKUP_ENABLED: 'false' }, { AZURE_BACKUP_ACCOUNT: 'evil.example/path' }, { AZURE_BACKUP_CONTAINER: '../private' },
      { AZURE_BACKUP_CONTAINER: 'bad--name' }, { AZURE_BACKUP_MAX_BYTES: String(MAX_ARCHIVE_BYTES + 1) },
      { AZURE_BACKUP_MAX_BYTES: 'NaN' }, { AZURE_BACKUP_MAX_BYTES: '-1' }, { AZURE_BACKUP_MANAGED_IDENTITY_CLIENT_ID: 'not-a-guid' },
    ]) expect(() => cloudBackupConfig({ ...env, ...override })).toThrow('configuration_invalid');
  });
});

describe('streaming block upload with mocked identity and storage', () => {
  it('uploads bounded checksummed blocks, commits once and confirms properties before returning success', async () => {
    const { calls, providers } = transportFixture();
    const chunks = [Buffer.alloc(BLOCK_BYTES, 1), Buffer.from('last block')];
    const result = await uploadSnapshotArchive(cloudBackupConfig(env), archive(chunks), new AbortController().signal, providers);
    expect(result).toEqual({ completedAt: NOW.toISOString(), archiveBytes: BLOCK_BYTES + 10 });
    expect(calls[0].url.href).toContain('169.254.169.254/metadata/identity/oauth2/token');
    expect(calls[0].headers).toEqual({ Metadata: 'true' });
    const blocks = calls.filter((call) => call.url.searchParams.get('comp') === 'block');
    expect(blocks.map((block) => block.body?.length)).toEqual([BLOCK_BYTES, 10]);
    for (const block of blocks) {
      expect(block.headers['Content-MD5']).toBe(createHash('md5').update(block.body!).digest('base64'));
      expect(block.url.hostname).toBe('fixtureaccount.blob.core.windows.net');
    }
    const commit = calls.find((call) => call.url.searchParams.get('comp') === 'blocklist')!;
    expect(commit.headers['If-None-Match']).toBe('*');
    expect(commit.headers['x-ms-meta-sha256']).toBe(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));
    // Azure rejects metadata whose name is not a valid C# identifier, so a hyphen fails every commit.
    const names = Object.keys(commit.headers).filter((name) => name.startsWith('x-ms-meta-')).map((name) => name.slice(10));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(calls.at(-1)?.method).toBe('HEAD');
    expect(JSON.stringify(result)).not.toMatch(/token|account|container|https|daily/);
  });
  it('fails before network activity when compression exceeds its configured ceiling', async () => {
    const { providers, request } = transportFixture();
    const source = archive([Buffer.alloc(32)]);
    await expect(uploadSnapshotArchive({ ...cloudBackupConfig(env), maxArchiveBytes: 31 }, source, new AbortController().signal, providers)).rejects.toThrow('archive_limit_exceeded');
    expect(request).not.toHaveBeenCalled();
    expect(source.cancel).toHaveBeenCalled();
  });
  it('does not commit when the archive producer fails after producing bytes', async () => {
    const { providers, calls } = transportFixture();
    const source = archive([Buffer.from('partial')], Promise.reject(new CloudBackupError('archive_failed')));
    await expect(uploadSnapshotArchive(cloudBackupConfig(env), source, new AbortController().signal, providers)).rejects.toThrow('archive_failed');
    expect(calls.some((call) => call.url.searchParams.get('comp') === 'blocklist')).toBe(false);
  });
  it('caps retryable block attempts and emits only a fixed sanitized error', async () => {
    const fixture = transportFixture();
    const base = fixture.providers.request;
    fixture.providers.request = vi.fn(async (input) => input.url.searchParams.get('comp') === 'block' ? response(503, { error: 'token=secret /private' }) : base(input));
    await expect(uploadSnapshotArchive(cloudBackupConfig(env), archive([Buffer.from('archive')]), new AbortController().signal, fixture.providers)).rejects.toThrow(/^upload_failed$/);
    expect(vi.mocked(fixture.providers.request).mock.calls.filter(([call]) => call.url.searchParams.get('comp') === 'block')).toHaveLength(3);
    expect(fixture.providers.sleep).toHaveBeenCalledTimes(2);
  });
  it('refreshes managed identity once on a 401 without introducing stored credentials', async () => {
    const fixture = transportFixture();
    const base = fixture.providers.request;
    let unauthorized = true;
    fixture.providers.request = async (input) => {
      if (input.url.searchParams.get('comp') === 'block' && unauthorized) { unauthorized = false; return response(401); }
      return base(input);
    };
    await uploadSnapshotArchive(cloudBackupConfig(env), archive([Buffer.from('archive')]), new AbortController().signal, fixture.providers);
    expect(fixture.calls.filter((call) => call.url.hostname === '169.254.169.254')).toHaveLength(2);
  });
  it('requires verified properties after an ambiguous commit response', async () => {
    const fixture = transportFixture();
    const base = fixture.providers.request;
    let lost = true;
    fixture.providers.request = async (input) => {
      if (input.url.searchParams.get('comp') === 'blocklist') {
        if (lost) { lost = false; await base(input); throw new Error('lost response'); }
        return response(412);
      }
      return base(input);
    };
    expect(await uploadSnapshotArchive(cloudBackupConfig(env), archive([Buffer.from('archive')]), new AbortController().signal, fixture.providers)).toMatchObject({ archiveBytes: 7 });
  });
  it.each(['length', 'hash', 'type'])('rejects a remote %s mismatch, without attesting success', async (field) => {
    const fixture = transportFixture();
    const base = fixture.providers.request;
    fixture.providers.request = async (input) => {
      const result = await base(input);
      if (input.method === 'HEAD') result.headers[field === 'length' ? 'content-length' : field === 'hash' ? 'x-ms-meta-sha256' : 'x-ms-blob-type'] = 'invalid';
      return result;
    };
    await expect(uploadSnapshotArchive(cloudBackupConfig(env), archive([Buffer.from('archive')]), new AbortController().signal, fixture.providers)).rejects.toThrow('verification_failed');
  });
  it('honors cancellation without requests', async () => {
    const fixture = transportFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(uploadSnapshotArchive(cloudBackupConfig(env), archive([Buffer.from('archive')]), controller.signal, fixture.providers)).rejects.toThrow('timeout');
    expect(fixture.request).not.toHaveBeenCalled();
  });
});

describe('completed snapshot validation with fake references, never a live DB', () => {
  let scratch: string | undefined;
  afterEach(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); scratch = undefined; });
  async function fixture() {
    scratch = await mkdtemp(path.join(process.cwd(), '.cloud-backup-test-'));
    const directory = path.join(scratch, 'cloud-run-20260905T080000Z-1234');
    const evidence = path.join(directory, 'evidence-20260905T080000Z');
    await mkdir(evidence, { recursive: true });
    await chmod(scratch, 0o750);
    await chmod(directory, 0o750);
    await chmod(evidence, 0o750);
    await writeFile(path.join(directory, 'app-20260905T080000Z.sqlite'), 'synthetic DB placeholder');
    await writeFile(path.join(evidence, 'proof.bin'), 'abc');
    const providers: SnapshotProviders = { lstat, readdir, realpath, references: () => [{ name: 'proof.bin', bytes: 3 }] };
    return { root: scratch, directory, evidence, providers };
  }
  it('selects precisely one SQLite snapshot plus matching referenced evidence', async () => {
    const value = await fixture();
    expect(await validateCompletedSnapshot(value.directory, value.root, value.providers)).toMatchObject({
      entries: ['app-20260905T080000Z.sqlite', 'evidence-20260905T080000Z'],
    });
  });
  it('preserves synchronous providers and supports awaited reference providers', async () => {
    const value = await fixture();
    const result = await validateCompletedSnapshot(value.directory, value.root, {
      ...value.providers, references: async () => [{ name: 'proof.bin', bytes: 3 }],
    });
    expect(result.entries).toEqual(['app-20260905T080000Z.sqlite', 'evidence-20260905T080000Z']);
    await expect(validateCompletedSnapshot(value.directory, value.root, {
      ...value.providers, references: async () => { throw new Error('private provider detail'); },
    })).rejects.toThrow(/^snapshot_invalid$/);
  });

  describe('fixed Python reference-reader boundary (no live package imports)', () => {
    const filename = '/fixture/cloud-run-20260905T080000Z-1234/app-20260905T080000Z.sqlite';
    it('uses only the fixed isolated stdlib helper with bounded execution and sanitized environment', async () => {
      const command = vi.fn<ReferenceCommand>().mockResolvedValue('{"version":1,"references":[{"name":"proof.bin","bytes":3}]}');
      expect(await readSnapshotReferences(filename, command)).toEqual([{ name: 'proof.bin', bytes: 3 }]);
      expect(command).toHaveBeenCalledWith('/usr/bin/python3', ['-I', '-S', REFERENCE_HELPER_PATH, filename], {
        encoding: 'utf8', timeout: 15000, maxBuffer: REFERENCE_OUTPUT_BYTES, killSignal: 'SIGKILL',
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      });
    });
    it('refuses live/default database names before invoking anything', async () => {
      const command = vi.fn<ReferenceCommand>();
      await expect(readSnapshotReferences('/var/lib/12-week-dashboard/app.sqlite', command)).rejects.toThrow('snapshot_invalid');
      expect(command).not.toHaveBeenCalled();
    });
    it.each([
      '{"version":1,"references":[{"name":"../secret","bytes":3}]}',
      '{"version":1,"references":[{"name":"proof.bin","bytes":-1}]}',
      '{"version":1,"references":[],"error":"private details"}',
      '{"version":1,"references":null}',
      'not json',
    ])('rejects malformed helper responses without echoing diagnostics', async (output) => {
      await expect(readSnapshotReferences(filename, async () => output)).rejects.toThrow(/^snapshot_invalid$/);
    });
    it('rejects output/row bounds and helper failure rather than returning partial references', async () => {
      await expect(readSnapshotReferences(filename, async () => 'x'.repeat(REFERENCE_OUTPUT_BYTES + 1))).rejects.toThrow('snapshot_invalid');
      const output = JSON.stringify({ version: 1, references: Array.from({ length: 10001 }, () => ({ name: 'proof.bin', bytes: 3 })) });
      await expect(readSnapshotReferences(filename, async () => output)).rejects.toThrow('snapshot_invalid');
      await expect(readSnapshotReferences(filename, async () => { throw new Error('SQL /private/location token=secret'); })).rejects.toThrow(/^snapshot_invalid$/);
    });
  });

  it.each([0, -1, null, 67108865])('rejects unsupported heap limit %j before opening the untrusted database', async (limit) => {
    const value = await fixture();
    const program = `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("reference_helper",sys.argv[1])
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
limit=json.loads(sys.argv[3])
opened=False
checked=False
closed=False
class Control:
    def execute(self, sql):
        global checked
        assert sql == "PRAGMA hard_heap_limit=67108864"
        checked=True
        return self
    def fetchone(self): return (limit,)
    def close(self):
        global closed
        closed=True
def guarded_connect(filename,*args,**kwargs):
    global opened
    if filename == ":memory:": return Control()
    opened=True
    raise AssertionError("untrusted database opened without a supported heap limit")
helper.sqlite3.connect=guarded_connect
try:
    helper.read_references(sys.argv[2])
except ValueError:
    assert checked and closed and not opened
    print("HEAP_LIMIT_REJECTED")
else:
    raise AssertionError("unsupported heap limit accepted")
`;
    const output = await new Promise<string>((resolve, reject) => {
      execFile('/usr/bin/python3', ['-I', '-S', '-c', program, REFERENCE_HELPER_PATH,
        path.join(value.directory, 'app-20260905T080000Z.sqlite'), JSON.stringify(limit)], {
        encoding: 'utf8', timeout: 15000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    expect(output.trim()).toBe('HEAP_LIMIT_REJECTED');
  });

  describe.skipIf(!sqliteTestCapability.supported)('stdlib SQLite helper (requires verified positive heap limit)', () => {
    let scratch: string | undefined;
    const fixtureCommand: ReferenceCommand = (_fixedExecutable, args, options) => new Promise((resolve, reject) => {
      execFile(sqliteTestCapability.executable, args, options, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    const readFixture = (filename: string) => readSnapshotReferences(filename, fixtureCommand);
    afterEach(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); scratch = undefined; });
    async function fixture(configure: (db: Database.Database) => void) {
      scratch = await mkdtemp(path.join(process.cwd(), '.cloud-reference-test-'));
      const directory = path.join(scratch, 'cloud-run-20260905T080000Z-1234');
      await mkdir(directory, { mode: 0o750 });
      const filename = path.join(directory, 'app-20260905T080000Z.sqlite');
      // The application test dependency creates a memory fixture only. The privileged
      // production reader imports no native Node module and reads this serialized copy.
      const db = new Database(':memory:');
      try {
        configure(db);
        await writeFile(filename, db.serialize(), { mode: 0o640 });
      } finally { db.close(); }
      return filename;
    }
    it('accepts prod001–007 style absence without adding a table or schema', async () => {
      const filename = await fixture((db) => db.exec('CREATE TABLE fixture_marker (id INTEGER)'));
      const before = await readFile(filename);
      expect(await readFixture(filename)).toEqual([]);
      expect(await readFile(filename)).toEqual(before);
      expect(await readdir(path.dirname(filename))).toEqual([path.basename(filename)]);
    });
    it('returns only validated bounded metadata and leaves the copy unchanged', async () => {
      const filename = await fixture((db) => {
        db.exec('CREATE TABLE tactic_evidence (file_stored_name, file_size)');
        db.prepare('INSERT INTO tactic_evidence VALUES (?, ?)').run('proof.bin', 3n);
        db.prepare('INSERT INTO tactic_evidence VALUES (?, ?)').run(null, null);
      });
      const before = await readFile(filename);
      expect(await readFixture(filename)).toEqual([{ name: 'proof.bin', bytes: 3 }]);
      expect(await readFile(filename)).toEqual(before);
    });
    it.each(['oversize-text', 'huge-blob', 'nul-suffix', 'bad-size', 'row-limit', 'view'])('rejects %s without omitting malformed rows', async (kind) => {
      const filename = await fixture((db) => {
        if (kind === 'view') {
          db.exec("CREATE VIEW tactic_evidence AS SELECT 'proof.bin' AS file_stored_name, 3 AS file_size");
          return;
        }
        db.exec('CREATE TABLE tactic_evidence (file_stored_name, file_size)');
        const insert = db.prepare('INSERT INTO tactic_evidence VALUES (?, ?)');
        insert.run('proof.bin', 3n);
        if (kind === 'oversize-text') insert.run('x'.repeat(2 * 1024 * 1024), 3n);
        if (kind === 'huge-blob') insert.run(Buffer.alloc(2 * 1024 * 1024), 3n);
        if (kind === 'nul-suffix') insert.run('proof.bin\0hidden', 3n);
        if (kind === 'bad-size') insert.run('other.bin', Buffer.alloc(2 * 1024 * 1024));
        if (kind === 'row-limit') db.transaction(() => { for (let n = 0; n < 10000; n++) insert.run('proof.bin', 3n); })();
      });
      await expect(readFixture(filename)).rejects.toThrow(/^snapshot_invalid$/);
    });
  });
  it('rejects incomplete, extra or wrong-sized evidence', async () => {
    const value = await fixture();
    await writeFile(path.join(value.evidence, 'proof.bin'), 'partial');
    await expect(validateCompletedSnapshot(value.directory, value.root, value.providers)).rejects.toThrow('snapshot_invalid');
    await writeFile(path.join(value.evidence, 'proof.bin'), 'abc');
    await writeFile(path.join(value.evidence, 'extra.bin'), 'extra');
    await expect(validateCompletedSnapshot(value.directory, value.root, value.providers)).rejects.toThrow('snapshot_invalid');
  });
  it('rejects unsafe metadata, writable staging directories and sidecars', async () => {
    const value = await fixture();
    await expect(validateCompletedSnapshot(value.directory, value.root, { ...value.providers, references: () => [{ name: '../outside', bytes: 3 }] })).rejects.toThrow('snapshot_invalid');
    await chmod(value.directory, 0o770);
    await expect(validateCompletedSnapshot(value.directory, value.root, value.providers)).rejects.toThrow('snapshot_invalid');
    await chmod(value.directory, 0o750);
    await writeFile(path.join(value.directory, 'app-20260905T080000Z.sqlite-wal'), 'unexpected');
    await expect(validateCompletedSnapshot(value.directory, value.root, value.providers)).rejects.toThrow('snapshot_invalid');
    expect(await readFile(path.join(value.evidence, 'proof.bin'), 'utf8')).toBe('abc');
  });
});
