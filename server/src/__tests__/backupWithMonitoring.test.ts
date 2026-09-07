import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const previousReceipt = '{"version":1,"completedAt":"2000-01-01T00:00:00.000Z"}\n';
const stamp = '20260905T090000Z';
interface Event {
  tool: string;
  args: string[];
  appSecret?: string | null;
  nodeOptions?: string | null;
  dbFile?: string | null;
}

describe('complete backup wrapper with isolated local subprocess fixtures', () => {
  let directory: string;
  let fixtureRoot: string;
  let fixtureBin: string;
  let data: string;
  let backups: string;
  let evidence: string;
  let state: string;
  let receipt: string;
  let wrapper: string;
  let nodeFixture: string;

  async function fixtureCommand(name: string, source: string) {
    const filename = path.join(fixtureBin, name);
    const preamble = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const base = ${JSON.stringify(directory)};
const mode = fs.readFileSync(path.join(base, 'mode'), 'utf8');
const args = process.argv.slice(2);
function event(tool) {
  fs.appendFileSync(path.join(base, 'events.jsonl'), JSON.stringify({
    tool, args, appSecret: process.env.MONITORING_TEST_SECRET ?? null,
    nodeOptions: process.env.NODE_OPTIONS ?? null, dbFile: process.env.DB_FILE ?? null,
  }) + '\\n');
}
`;
    await writeFile(filename, preamble + source, { mode: 0o700 });
    return filename;
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(process.cwd(), '.monitoring-backup-test-'));
    fixtureRoot = path.join(directory, 'fixture-project');
    fixtureBin = path.join(directory, 'bin');
    data = path.join(directory, 'explicit data');
    backups = path.join(directory, 'explicit backups');
    evidence = path.join(directory, 'separate evidence');
    state = path.join(directory, 'protected state');
    receipt = path.join(state, 'file-backup-success.json');
    wrapper = path.join(fixtureRoot, 'scripts/backup-with-monitoring.sh');
    await Promise.all([fixtureBin, data, backups, evidence, state, path.join(fixtureRoot, 'scripts'), path.join(fixtureRoot, 'server/dist/lib')]
      .map((filename) => mkdir(filename, { recursive: true })));
    await chmod(state, 0o750);
    await writeFile(receipt, previousReceipt, { mode: 0o640 });
    await writeFile(path.join(data, 'app.sqlite'), 'synthetic database placeholder — never opened by SQLite');
    await writeFile(path.join(evidence, 'proof.txt'), 'synthetic evidence bytes');
    await writeFile(path.join(directory, 'mode'), 'success');
    await writeFile(path.join(directory, 'events.jsonl'), '');
    await writeFile(path.join(fixtureBin, 'package.json'), '{"type":"commonjs"}');
    await writeFile(path.join(fixtureRoot, 'package.json'), '{"type":"module"}');
    await copyFile(path.join(project, 'scripts/backup-with-monitoring.sh'), wrapper);
    // Build only the real receipt CLI dependency graph in this disposable project-local fixture.
    for (const name of ['monitoringProbe', 'lib/monitoringCollector', 'lib/monitoringFiles', 'lib/monitoringProbe', 'lib/monitoringTypes', 'lib/cloudBackupConfig']) {
      const source = await readFile(path.join(project, 'server/src', `${name}.ts`), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
      await writeFile(path.join(fixtureRoot, 'server/dist', `${name}.js`), compiled.outputText);
    }
    await writeFile(path.join(fixtureRoot, 'server/dist/cloudBackup.js'), "throw new Error('Cloud uploads must be mocked in this fixture');\n");

    // The wrapper's producer is mocked; the real privileged producer has separate regressions.
    await fixtureCommand('dirname', "console.log(path.dirname(args[0]));\n");
    await fixtureCommand('mkdir', "if (args[0] === '-p' && args.length === 2) fs.mkdirSync(args[1], { recursive: true }); else if (args.length === 1) fs.mkdirSync(args[0]); else process.exit(90);\n");
    await fixtureCommand('date', `if (JSON.stringify(args) !== JSON.stringify(['-u', '+%Y%m%dT%H%M%SZ'])) process.exit(90); console.log('${stamp}');\n`);
    await fixtureCommand('sleep', 'process.exit(0);\n');
    const producer = await fixtureCommand('producer', `
event('producer');
if (args.length !== 3 || !args.every((p) => p.startsWith(base + path.sep))) process.exit(90);
if (!fs.existsSync(path.join(args[0], process.env.DB_FILE))) process.exit(1);
fs.writeFileSync(path.join(args[1], 'app-${stamp}.sqlite'), 'synthetic backup artifact');
if (mode === 'sqlite-failure') process.exit(51);
if (mode === 'reference-query-failure' || mode === 'missing-evidence') process.exit(1);
if (mode === 'legacy-no-evidence' || mode === 'empty-evidence') process.exit(0);
const target = path.join(args[1], 'evidence-${stamp}');
fs.mkdirSync(target);
if (mode === 'copy-failure') {
  fs.writeFileSync(path.join(target, 'proof.txt'), 'partial evidence fixture');
  process.exit(53);
}
fs.copyFileSync(path.join(args[2], 'proof.txt'), path.join(target, 'proof.txt'));
`);
    await writeFile(path.join(fixtureRoot, 'scripts/backup.sh'), `#!/bin/bash\nexec ${JSON.stringify(producer)} "$@"\n`);
    nodeFixture = await fixtureCommand('receipt-node', `
const cloud = path.join(${JSON.stringify(fixtureRoot)}, 'server/dist/cloudBackup.js');
if (args[0] === cloud) {
  event('cloud');
  if (args.length !== 3 || args[1] !== '--upload-complete-snapshot' || !args[2].startsWith(${JSON.stringify(backups)} + path.sep)) process.exit(90);
  if (mode === 'cloud-failure') process.exit(70);
  const receipt = path.join(process.env.MONITORING_STATE_DIR, 'cloud-backup-success.json');
  const staging = receipt + '.fixture-partial';
  fs.writeFileSync(staging, JSON.stringify({ version: 1, completedAt: new Date().toISOString(), archiveBytes: 1234 }), { mode: 0o640 });
  fs.renameSync(staging, receipt);
  process.exit(0);
}
event('receipt');
const expected = path.join(${JSON.stringify(fixtureRoot)}, 'server/dist/monitoringProbe.js');
if (args.length !== 2 || args[0] !== expected || args[1] !== '--record-file-backup-success') process.exit(90);
const child = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, args, {
  env: process.env, stdio: 'inherit', timeout: 5000,
});
process.exit(child.status ?? 91);
`);
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  function run(args = [data, backups, evidence, state], extraEnv: Record<string, string> = {}) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile('/bin/bash', [wrapper, ...args], {
        cwd: fixtureRoot, timeout: 10_000, maxBuffer: 64 * 1024,
        env: {
          PATH: fixtureBin, MONITORING_NODE_BIN: nodeFixture,
          MONITORING_TEST_SECRET: 'synthetic-secret-not-to-forward', NODE_OPTIONS: '--no-warnings',
          ...extraEnv,
        },
      }, (error, stdout, stderr) => {
        resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout, stderr });
      });
    });
  }
  async function events(): Promise<Event[]> {
    const content = await readFile(path.join(directory, 'events.jsonl'), 'utf8');
    return content.trim() ? content.trim().split('\n').map((line) => JSON.parse(line) as Event) : [];
  }

  it.each([
    ['sqlite-failure', 51],
    ['reference-query-failure', 1],
    ['missing-evidence', 1],
    ['copy-failure', 53],
  ])('preserves the prior receipt for %s even when a backup artifact exists', async (mode, code) => {
    await writeFile(path.join(directory, 'mode'), mode);
    const before = await stat(receipt);
    const result = await run();
    expect(result.code).toBe(code);
    expect(result.stderr).toContain('the monitoring success receipt was not changed');
    expect(await readFile(path.join(backups, `app-${stamp}.sqlite`), 'utf8')).toBe('synthetic backup artifact');
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
    expect((await stat(receipt)).ino).toBe(before.ino);
    expect(await readdir(state)).toEqual(['file-backup-success.json']);
    expect((await events()).some((event) => event.tool === 'receipt')).toBe(false);
  });

  it('does not create an initial receipt for an incomplete first backup', async () => {
    await rm(receipt);
    await writeFile(path.join(directory, 'mode'), 'missing-evidence');
    expect((await run()).code).toBe(1);
    expect(await readdir(state)).toEqual([]);
    expect((await events()).some((event) => event.tool === 'receipt')).toBe(false);
  });

  it('does not claim success when the fixed producer is unavailable', async () => {
    await rm(path.join(fixtureRoot, 'scripts/backup.sh'));
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('fixed backup script is unavailable');
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
    expect((await events()).some((event) => event.tool === 'receipt')).toBe(false);
  });

  it('forwards explicit directories and publishes a successful receipt by atomic replacement', async () => {
    const old = await open(receipt, 'r');
    try {
      const before = await old.stat();
      const result = await run();
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('monitoring receipt published');
      expect(await readFile(path.join(backups, `evidence-${stamp}/proof.txt`), 'utf8')).toBe('synthetic evidence bytes');
      const current = JSON.parse(await readFile(receipt, 'utf8'));
      expect(Object.keys(current).sort()).toEqual(['completedAt', 'version']);
      expect(current.version).toBe(1);
      expect(new Date(current.completedAt).toISOString()).toBe(current.completedAt);
      expect(current.completedAt).not.toBe(JSON.parse(previousReceipt).completedAt);
      expect((await stat(receipt)).ino).not.toBe(before.ino);
      expect((await stat(receipt)).mode & 0o777).toBe(0o640);
      expect(await old.readFile('utf8')).toBe(previousReceipt);
      expect(await readdir(state)).toEqual(['file-backup-success.json']);
      const calls = await events();
      expect(calls[0]).toMatchObject({ tool: 'producer', args: [data, backups, evidence], dbFile: 'app.sqlite' });
      expect(calls.at(-1)).toMatchObject({ tool: 'receipt', args: [path.join(fixtureRoot, 'server/dist/monitoringProbe.js'), '--record-file-backup-success'] });
      expect(calls.every((event) => event.appSecret === null && event.nodeOptions === null)).toBe(true);
    } finally {
      await old.close();
    }
  });

  it.each(['legacy-no-evidence', 'empty-evidence'])('records valid %s backup success', async (mode) => {
    await writeFile(path.join(directory, 'mode'), mode);
    const result = await run();
    expect(result.code, result.stderr).toBe(0);
    expect(await readFile(receipt, 'utf8')).not.toBe(previousReceipt);
    expect((await events()).filter((event) => event.tool === 'receipt')).toHaveLength(1);
  });

  it('preserves the explicit DB_FILE override at the producer boundary', async () => {
    await copyFile(path.join(data, 'app.sqlite'), path.join(data, 'custom.sqlite'));
    const result = await run(undefined, { DB_FILE: 'custom.sqlite' });
    expect(result.code, result.stderr).toBe(0);
    expect((await events())[0]).toMatchObject({ tool: 'producer', dbFile: 'custom.sqlite' });
  });

  it('reports receipt publication failure and leaves prior metadata intact', async () => {
    await chmod(state, 0o770);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Backup completed, but receipt publication failed');
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
    expect(await readFile(path.join(backups, `evidence-${stamp}/proof.txt`), 'utf8')).toBe('synthetic evidence bytes');
  });

  it('fails before backup when the fixed built CLI is missing', async () => {
    await rm(path.join(fixtureRoot, 'server/dist/monitoringProbe.js'));
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('monitoring CLI is not built');
    expect(await events()).toEqual([]);
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
  });

  it('rejects missing/relative/SQLite-quote-breaking directories and command arguments', async () => {
    for (const args of [[], [data, backups, evidence], ['relative', backups, evidence, state],
      [data, `${backups}'bad`, evidence, state], [data, backups, evidence, state, '--anything']]) {
      expect((await run(args)).code).toBe(1);
    }
    expect((await run(undefined, { DB_FILE: '../outside.sqlite' })).code).toBe(1);
    expect((await run(undefined, { MONITORING_NODE_BIN: 'node' })).code).toBe(1);
    expect(await events()).toEqual([]);
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
  });

  it('withholds both success receipts after a failed optional cloud upload', async () => {
    await writeFile(path.join(directory, 'mode'), 'cloud-failure');
    const priorCloud = JSON.stringify({ version: 1, completedAt: '2000-01-01T00:00:00.000Z', archiveBytes: 1 });
    await writeFile(path.join(state, 'cloud-backup-success.json'), priorCloud);
    const result = await run(undefined, { AZURE_BACKUP_ENABLED: 'true', AZURE_BACKUP_ACCOUNT: 'fixtureaccount', AZURE_BACKUP_CONTAINER: 'private-backups' });
    expect(result.code).toBe(70);
    expect(result.stderr).toContain('Cloud backup pipeline failed');
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
    expect(await readFile(path.join(state, 'cloud-backup-success.json'), 'utf8')).toBe(priorCloud);
    expect((await events()).some((event) => event.tool === 'receipt')).toBe(false);
    const runs = await readdir(backups);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatch(/^cloud-run-20260905T090000Z-\d+$/);
    expect(await readFile(path.join(backups, runs[0], `evidence-${stamp}/proof.txt`), 'utf8')).toBe('synthetic evidence bytes');
  });

  it('attests cloud success before advancing local success in the enabled pipeline', async () => {
    const result = await run(undefined, { AZURE_BACKUP_ENABLED: 'true', AZURE_BACKUP_ACCOUNT: 'fixtureaccount', AZURE_BACKUP_CONTAINER: 'private-backups' });
    expect(result.code, result.stderr).toBe(0);
    expect((await events()).filter((event) => event.tool === 'cloud' || event.tool === 'receipt').map((event) => event.tool)).toEqual(['cloud', 'receipt']);
    expect(await readFile(receipt, 'utf8')).not.toBe(previousReceipt);
    expect(JSON.parse(await readFile(path.join(state, 'cloud-backup-success.json'), 'utf8')).archiveBytes).toBe(1234);
  });

  it('never attempts cloud upload after incomplete local evidence backup', async () => {
    await writeFile(path.join(directory, 'mode'), 'missing-evidence');
    const result = await run(undefined, { AZURE_BACKUP_ENABLED: 'true', AZURE_BACKUP_ACCOUNT: 'fixtureaccount', AZURE_BACKUP_CONTAINER: 'private-backups' });
    expect(result.code).toBe(1);
    expect((await events()).some((event) => event.tool === 'cloud' || event.tool === 'receipt')).toBe(false);
    expect(await readFile(receipt, 'utf8')).toBe(previousReceipt);
  });
});

describe('backup deployment samples stay local and opt-in', () => {
  it('uses the fixed wrapper, protected state, snap Node and no app secrets', async () => {
    const service = await readFile(path.join(project, 'deploy/12-week-dashboard-backup.service.sample'), 'utf8');
    expect(service).toMatch(/^User=root$/m);
    expect(service).toMatch(/^Group=copilot-agent$/m);
    expect(service).toMatch(/^Environment=MONITORING_NODE_BIN=\/snap\/node\/current\/bin\/node$/m);
    expect(service).toMatch(/^StateDirectoryMode=0750$/m);
    expect(service).toMatch(/^ExecStart=\/bin\/bash \/opt\/12-week-dashboard\/scripts\/backup-with-monitoring\.sh /m);
    expect(service).not.toMatch(/^EnvironmentFile=/m);
    expect(service).toMatch(/^IPAddressDeny=any$/m);
    const timer = await readFile(path.join(project, 'deploy/12-week-dashboard-backup.timer.sample'), 'utf8');
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* 03:20:00 Asia\/Jerusalem$/m);
    expect(timer).toMatch(/^Persistent=true$/m);
    expect(timer).toMatch(/^Unit=12-week-dashboard-backup.service$/m);
  });
});
