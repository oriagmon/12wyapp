import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectOperationalProbe, localSystemctl, MAX_CERT_BYTES, MAX_SYSTEMCTL_BYTES, parseBackupTimerSelection, parseLocalCertificate, parseSystemctlTimer, parseTimerSelection,
  type CollectorProviders,
} from '../lib/monitoringCollector.js';
import { BACKUP_RECEIPT_FILENAME, MAX_PROBE_BYTES, PROBE_FILENAME, readBoundedFile, writeAtomicJson } from '../lib/monitoringFiles.js';
import { BACKUP_TIMER_UNITS, TIMER_UNITS, type BackupTimerSelection } from '../lib/monitoringTypes.js';
import { runMonitoringProbe } from '../monitoringProbe.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  X509Certificate: vi.fn(),
}));

const NOW = new Date('2026-09-05T08:00:00.000Z');
const validTimer = 'LoadState=loaded\nActiveState=active\nNextElapseUSecRealtime=Sun 2026-09-06 00:00:00 UTC\n';

function syntheticCertificate(): Buffer {
  const der = (tag: number, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts);
    const length = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
  };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const algorithm = der(0x30, der(0x06, Buffer.from([0x2b, 0x65, 0x70])));
  const name = der(0x30, der(0x31, der(0x30, der(0x06, Buffer.from([0x55, 0x04, 0x03])), der(0x0c, Buffer.from('offline-fixture')))));
  const tbs = der(0x30,
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), algorithm, name,
    der(0x30, der(0x17, Buffer.from('260101000000Z')), der(0x17, Buffer.from('270101000000Z'))),
    name, publicKey.export({ type: 'spki', format: 'der' }),
  );
  return der(0x30, tbs, algorithm, der(0x03, Buffer.from([0]), sign(null, tbs, privateKey)));
}
describe('offline operational collector', () => {
  let providers: CollectorProviders;
  beforeEach(() => {
    vi.clearAllMocks();
    providers = { now: () => NOW, systemctl: vi.fn().mockResolvedValue(validTimer), readFile: vi.fn() };
    vi.mocked(X509Certificate).mockImplementation(() => ({ validFrom: 'Jan 1 00:00:00 2026 GMT', validTo: 'Jan 1 00:00:00 2027 GMT' }) as X509Certificate);
  });
  it('does nothing operational when optional providers are not configured', async () => {
    const probe = await collectOperationalProbe({ stateDirectory: '/fake', timers: [], fileBackupEnabled: false }, providers);
    expect(probe.timers.every((timer) => timer.state === 'not_configured')).toBe(true);
    expect(probe.fileBackup.state).toBe('not_configured');
    expect(probe.certificate.state).toBe('not_configured');
    expect(providers.systemctl).not.toHaveBeenCalled();
    expect(providers.readFile).not.toHaveBeenCalled();
  });
  it('only invokes fixed selected unit names and discards provider errors', async () => {
    vi.mocked(providers.systemctl).mockRejectedValue(new Error('token=secret /private/hostname'));
    vi.mocked(providers.readFile).mockRejectedValue(new Error('private certificate file'));
    const probe = await collectOperationalProbe({
      stateDirectory: '/fake', timers: ['weekly', 'broost'], certificateFile: '/fake/cert.pem', fileBackupEnabled: true,
    }, providers);
    expect(providers.systemctl).toHaveBeenCalledTimes(2);
    expect(providers.systemctl).toHaveBeenCalledWith(TIMER_UNITS.weekly);
    expect(providers.systemctl).toHaveBeenCalledWith(TIMER_UNITS.broost);
    expect(probe.timers[0].state).toBe('unknown');
    expect(probe.certificate.state).toBe('unknown');
    expect(probe.fileBackup.state).toBe('unknown');
    expect(JSON.stringify(probe)).not.toMatch(/secret|private|fake|token/);
  });
  it.each(['evil.timer', 'weekly;whoami', '../weekly', 'toString', '__proto__', 'weekly,weekly', 'weekly,'])('rejects timer selection %s', (value) => {
    expect(() => parseTimerSelection(value)).toThrow('invalid_timer_configuration');
  });
  it('allows only the documented timer aliases', () => {
    expect(parseTimerSelection(undefined)).toEqual([]);
    expect(parseTimerSelection(' weekly,reminders,broost,backup ')).toEqual(['weekly', 'reminders', 'broost', 'backup']);
  });
  it.each(['', 'unknown', 'toString', '__proto__', 'standard;id', BACKUP_TIMER_UNITS['standalone-blob']])('rejects invalid backup timer selection %s', (value) => {
    expect(() => parseBackupTimerSelection(value)).toThrow('invalid_backup_timer_configuration');
  });
  it.each<BackupTimerSelection | undefined>([undefined, 'standard', 'standalone-blob'])('selects the fixed backup unit for %s without changing the public timer ID', async (selection) => {
    const probe = await collectOperationalProbe({
      stateDirectory: '/fake', timers: ['backup'], backupTimer: selection,
      fileBackupEnabled: false, cloudBackupEnabled: true,
    }, providers);
    expect(providers.systemctl).toHaveBeenCalledTimes(1);
    expect(providers.systemctl).toHaveBeenCalledWith(BACKUP_TIMER_UNITS[selection ?? 'standard']);
    expect(probe.timers).toHaveLength(4);
    expect(probe.timers.find((timer) => timer.id === 'backup')).toEqual({
      id: 'backup', state: 'active', nextRunAt: '2026-09-06T00:00:00.000Z',
    });
  });
  it('bounds execFile and does not invoke a shell or propagate environment secrets', async () => {
    vi.mocked(execFile).mockImplementation(((file: string, args: string[], options: object, callback: (error: Error | null, stdout: string) => void) => {
      callback(null, validTimer);
    }) as typeof execFile);
    expect(await localSystemctl(TIMER_UNITS.weekly)).toBe(validTimer);
    const [file, args, options] = vi.mocked(execFile).mock.calls[0];
    expect(file).toBe('/usr/bin/systemctl');
    expect(args).toEqual(['show', '--no-pager', '--property=LoadState,ActiveState,NextElapseUSecRealtime', '--', TIMER_UNITS.weekly]);
    expect(options).toMatchObject({ timeout: 3000, maxBuffer: 4096, encoding: 'utf8' });
    expect(options).not.toHaveProperty('shell');
    expect(Object.keys((options as { env: object }).env).sort()).toEqual(['LANG', 'LC_ALL', 'PATH', 'SYSTEMD_PAGER', 'TZ']);
    await expect(localSystemctl('evil.service' as typeof TIMER_UNITS.weekly)).rejects.toThrow('invalid_timer');
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('sanitizes subprocess failures, including timeout and output cap errors', async () => {
    vi.mocked(execFile).mockImplementation(((_file: string, _args: string[], _options: object, callback: (error: Error, stdout: string) => void) => {
      callback(new Error('/private/foo token=secret'), '');
    }) as typeof execFile);
    await expect(localSystemctl(TIMER_UNITS.weekly)).rejects.toThrow(/^timer_unavailable$/);
  });
  it('parses fixed systemctl properties only, including inactive and failed units', () => {
    expect(parseSystemctlTimer('weekly', validTimer)).toEqual({ id: 'weekly', state: 'active', nextRunAt: '2026-09-06T00:00:00.000Z' });
    for (const state of ['inactive', 'failed'] as const) {
      expect(parseSystemctlTimer('weekly', validTimer.replace('ActiveState=active', `ActiveState=${state}`))).toEqual({ id: 'weekly', state, nextRunAt: null });
    }
    expect(parseSystemctlTimer('weekly', validTimer.replace('Sun 2026-09-06 00:00:00 UTC', 'n/a'))).toEqual({ id: 'weekly', state: 'active', nextRunAt: null });
  });
  it.each([
    'LoadState=not-found\nActiveState=inactive\nNextElapseUSecRealtime=\n',
    'LoadState=loaded\nActiveState=activating\nNextElapseUSecRealtime=\n',
    'LoadState=loaded\nActiveState=active\n',
    validTimer + 'Description=private text\n',
    validTimer + 'ActiveState=failed\n',
    validTimer.replace('Sun 2026-09-06 00:00:00 UTC', 'Mon 2026-02-30 00:00:00 UTC'),
    validTimer.replace('UTC', 'arbitrary hostname'),
    'x'.repeat(MAX_SYSTEMCTL_BYTES + 1),
  ])('marks unsupported/malformed timer output unknown', (output) => {
    expect(parseSystemctlTimer('weekly', output)).toEqual({ id: 'weekly', state: 'unknown', nextRunAt: null });
  });
  it('extracts only X509 validity, never certificate identities', () => {
    const bytes = Buffer.from('synthetic public certificate fixture');
    expect(parseLocalCertificate(bytes)).toEqual({ state: 'observed', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z' });
    expect(X509Certificate).toHaveBeenCalledWith(bytes);
    vi.mocked(X509Certificate).mockImplementation(() => { throw new Error('/private/key.pem'); });
    expect(parseLocalCertificate(bytes).state).toBe('unknown');
    vi.mocked(X509Certificate).mockClear();
    expect(parseLocalCertificate(Buffer.alloc(MAX_CERT_BYTES + 1)).state).toBe('unknown');
    expect(X509Certificate).not.toHaveBeenCalled();
  });
  it('parses a real synthetic X509 certificate created entirely in memory', async () => {
    const { X509Certificate: RealCertificate } = await vi.importActual<typeof import('node:crypto')>('node:crypto');
    vi.mocked(X509Certificate).mockImplementation((bytes) => new RealCertificate(bytes));
    expect(parseLocalCertificate(syntheticCertificate())).toEqual({
      state: 'observed', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
    });
    expect(parseLocalCertificate(Buffer.from('invalid fixture'))).toEqual({ state: 'unknown', validFrom: null, validTo: null });
  });
  it('reads bounded local certificate and completion receipt files only', async () => {
    vi.mocked(providers.readFile).mockImplementation(async (filename) => filename.endsWith('cert.pem')
      ? Buffer.from('synthetic certificate') : Buffer.from(JSON.stringify({ version: 1, completedAt: '2026-09-05T07:00:00.000Z' })));
    const probe = await collectOperationalProbe({ stateDirectory: '/fake', timers: ['weekly'], certificateFile: '/fake/cert.pem', fileBackupEnabled: true }, providers);
    expect(probe.certificate.state).toBe('observed');
    expect(probe.fileBackup).toEqual({ state: 'observed', lastSuccessAt: '2026-09-05T07:00:00.000Z' });
    expect(providers.readFile).toHaveBeenCalledWith('/fake/cert.pem', MAX_CERT_BYTES);
    expect(providers.readFile).toHaveBeenCalledWith(`/fake/${BACKUP_RECEIPT_FILENAME}`, 1024);
  });
  it.each([
    '{bad',
    JSON.stringify({ version: 1, completedAt: '2026-09-05T08:00:00.001Z' }),
    JSON.stringify({ version: 1, completedAt: '2026-09-05T07:00:00.000Z', path: '/private' }),
    JSON.stringify({ version: 1, completedAt: 'not-a-date' }),
    'x'.repeat(1025),
  ])('does not invent file-backup health for a bad receipt', async (receipt) => {
    vi.mocked(providers.readFile).mockResolvedValue(Buffer.from(receipt));
    const probe = await collectOperationalProbe({ stateDirectory: '/fake', timers: [], fileBackupEnabled: true }, providers);
    expect(probe.fileBackup).toEqual({ state: 'unknown', lastSuccessAt: null });
  });
  it('reads only a bounded separate cloud receipt, without querying Azure', async () => {
    vi.mocked(providers.readFile).mockResolvedValue(Buffer.from(JSON.stringify({ version: 1, completedAt: '2026-09-05T07:00:00.000Z', archiveBytes: 1234 })));
    const probe = await collectOperationalProbe({ stateDirectory: '/fake', timers: [], fileBackupEnabled: false, cloudBackupEnabled: true }, providers);
    expect(probe.cloudBackup).toEqual({ state: 'observed', lastSuccessAt: '2026-09-05T07:00:00.000Z', archiveBytes: 1234 });
    expect(providers.readFile).toHaveBeenCalledWith('/fake/cloud-backup-success.json', 1024);
    expect(providers.systemctl).not.toHaveBeenCalled();
  });
  it.each([
    { version: 1, completedAt: '2026-09-05T08:00:00.001Z', archiveBytes: 1234 },
    { version: 1, completedAt: '2026-09-05T07:00:00.000Z', archiveBytes: 0 },
    { version: 1, completedAt: '2026-09-05T07:00:00.000Z', archiveBytes: 268435457 },
    { version: 1, completedAt: '2026-09-05T07:00:00.000Z', archiveBytes: 1234, account: 'private-account' },
  ])('does not claim remote success from a malformed or future receipt', async (receipt) => {
    vi.mocked(providers.readFile).mockResolvedValue(Buffer.from(JSON.stringify(receipt)));
    const probe = await collectOperationalProbe({ stateDirectory: '/fake', timers: [], fileBackupEnabled: false, cloudBackupEnabled: true }, providers);
    expect(probe.cloudBackup).toEqual({ state: 'unknown', lastSuccessAt: null, archiveBytes: null });
  });
});

describe('bounded atomic state files (isolated project-local scratch)', () => {
  let directory: string;
  beforeEach(async () => {
    // No os.tmpdir(): this suite never writes outside its own workspace.
    directory = await mkdtemp(path.resolve(process.cwd(), '.monitoring-test-'));
    await chmod(directory, 0o750);
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('atomically replaces a bounded mode-0640 file without leaving staging data', async () => {
    await writeAtomicJson(directory, PROBE_FILENAME, { version: 1 });
    await writeAtomicJson(directory, PROBE_FILENAME, { version: 2 });
    expect(JSON.parse(await readFile(path.join(directory, PROBE_FILENAME), 'utf8'))).toEqual({ version: 2 });
    expect((await stat(path.join(directory, PROBE_FILENAME))).mode & 0o777).toBe(0o640);
    expect(await readdir(directory)).toEqual([PROBE_FILENAME]);
    expect(await readBoundedFile(path.join(directory, PROBE_FILENAME), MAX_PROBE_BYTES)).toEqual(Buffer.from('{"version":2}\n'));
  });
  it('rejects oversized and nonregular inputs without reading past the cap', async () => {
    const filename = path.join(directory, 'oversized');
    await writeFile(filename, Buffer.alloc(MAX_PROBE_BYTES + 1));
    await expect(readBoundedFile(filename, MAX_PROBE_BYTES)).rejects.toMatchObject({ code: 'oversized' });
    await expect(readBoundedFile(directory, MAX_PROBE_BYTES)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(writeAtomicJson(directory, PROBE_FILENAME, 'x'.repeat(MAX_PROBE_BYTES))).rejects.toMatchObject({ code: 'oversized' });
    expect(await readdir(directory)).toEqual(['oversized']);
  });
  it('rejects symlinks, writable state directories and arbitrary output filenames', async () => {
    await writeFile(path.join(directory, 'target'), 'fixture');
    await symlink(path.join(directory, 'target'), path.join(directory, 'link'));
    await expect(readBoundedFile(path.join(directory, 'link'), 1024)).rejects.toBeDefined();
    await mkdir(path.join(directory, 'real-dir'));
    await symlink(path.join(directory, 'real-dir'), path.join(directory, 'dir-link'));
    await expect(writeAtomicJson(path.join(directory, 'dir-link'), PROBE_FILENAME, {})).rejects.toThrow('invalid_state_directory');
    await expect(writeAtomicJson(directory, '../outside', {})).rejects.toThrow('invalid_output');
    await chmod(directory, 0o770);
    await expect(writeAtomicJson(directory, PROBE_FILENAME, {})).rejects.toThrow('invalid_state_directory');
  });
  it('records only an explicitly enabled completion receipt and never probes services', async () => {
    vi.mocked(execFile).mockClear();
    await expect(runMonitoringProbe(['--record-file-backup-success'], { MONITORING_STATE_DIR: directory })).rejects.toThrow('file_backup_not_configured');
    await runMonitoringProbe(['--record-file-backup-success'], { MONITORING_STATE_DIR: directory, MONITORING_FILE_BACKUP_ENABLED: 'true' });
    const receipt = JSON.parse(await readFile(path.join(directory, BACKUP_RECEIPT_FILENAME), 'utf8'));
    expect(Object.keys(receipt).sort()).toEqual(['completedAt', 'version']);
    expect(receipt.version).toBe(1);
    expect(new Date(receipt.completedAt).toISOString()).toBe(receipt.completedAt);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('wires the explicit standalone backup timer through the CLI configuration', async () => {
    vi.mocked(execFile).mockClear();
    vi.mocked(execFile).mockImplementation(((file: string, args: string[], options: object, callback: (error: Error | null, stdout: string) => void) => {
      callback(null, validTimer);
    }) as typeof execFile);
    await runMonitoringProbe([], {
      MONITORING_STATE_DIR: directory, MONITORING_TIMERS: 'backup', MONITORING_BACKUP_TIMER: 'standalone-blob',
    });
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual([
      'show', '--no-pager', '--property=LoadState,ActiveState,NextElapseUSecRealtime', '--', BACKUP_TIMER_UNITS['standalone-blob'],
    ]);
    const probe = JSON.parse(await readFile(path.join(directory, PROBE_FILENAME), 'utf8'));
    expect(probe.timers.find((timer: { id: string }) => timer.id === 'backup').state).toBe('active');
  });
  it('rejects an arbitrary backup unit before collecting or publishing state', async () => {
    vi.mocked(execFile).mockClear();
    await expect(runMonitoringProbe([], {
      MONITORING_STATE_DIR: directory, MONITORING_TIMERS: 'backup', MONITORING_BACKUP_TIMER: 'untrusted.timer',
    })).rejects.toThrow('invalid_backup_timer_configuration');
    expect(execFile).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects arbitrary CLI commands and relative state directories', async () => {
    await expect(runMonitoringProbe(['restart'], {})).rejects.toThrow('invalid_arguments');
    await expect(runMonitoringProbe([], { MONITORING_STATE_DIR: 'relative' })).rejects.toThrow('state_directory_required');
  });
});
