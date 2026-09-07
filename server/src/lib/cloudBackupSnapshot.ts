import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { CloudBackupError, MAX_EVIDENCE_FILES, MAX_SOURCE_BYTES } from './cloudBackupConfig.js';

export interface EvidenceReference { name: string; bytes: number }
export const REFERENCE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const REFERENCE_HELPER_PATH = fileURLToPath(new URL('../assets/cloud_backup_references.py', import.meta.url));
export interface SnapshotFiles {
  directory: string;
  entries: string[];
  sourceBytes: number;
}
export interface SnapshotProviders {
  lstat: typeof lstat;
  readdir: (directory: string) => Promise<string[]>;
  realpath: (filename: string) => Promise<string>;
  references: (database: string) => Iterable<EvidenceReference> | Promise<Iterable<EvidenceReference>>;
}

export interface ReferenceCommandOptions {
  encoding: 'utf8';
  timeout: number;
  maxBuffer: number;
  killSignal: 'SIGKILL';
  env: Record<string, string>;
}
export type ReferenceCommand = (executable: string, args: string[], options: ReferenceCommandOptions) => Promise<string>;
const runReferenceCommand: ReferenceCommand = (executable, args, options) => new Promise((resolve, reject) => {
  execFile(executable, args, options, (error, stdout) => {
    if (error) reject(new CloudBackupError('snapshot_invalid'));
    else resolve(stdout);
  });
});

/** OS SQLite reads only the completed copy. No live application package is imported. */
export async function readSnapshotReferences(filename: string, command: ReferenceCommand = runReferenceCommand): Promise<EvidenceReference[]> {
  try {
    if (!path.isAbsolute(filename) || !/^app-\d{8}T\d{6}Z\.sqlite$/.test(path.basename(filename))
      || !/^cloud-run-\d{8}T\d{6}Z-\d+$/.test(path.basename(path.dirname(filename)))) throw new CloudBackupError('snapshot_invalid');
    const output = await command('/usr/bin/python3', ['-I', '-S', REFERENCE_HELPER_PATH, filename], {
      encoding: 'utf8', timeout: 15000, maxBuffer: REFERENCE_OUTPUT_BYTES, killSignal: 'SIGKILL',
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    });
    if (Buffer.byteLength(output) > REFERENCE_OUTPUT_BYTES) throw new CloudBackupError('snapshot_invalid');
    const result: unknown = JSON.parse(output);
    if (typeof result !== 'object' || result === null || Array.isArray(result)
      || Object.keys(result).sort().join(',') !== 'references,version') throw new CloudBackupError('snapshot_invalid');
    const value = result as { version: unknown; references: unknown };
    if (value.version !== 1 || !Array.isArray(value.references) || value.references.length > MAX_EVIDENCE_FILES) throw new CloudBackupError('snapshot_invalid');
    const references: EvidenceReference[] = [];
    for (const row of value.references) {
      if (typeof row !== 'object' || row === null || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'bytes,name'
        || typeof row.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(row.name)
        || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > MAX_SOURCE_BYTES) throw new CloudBackupError('snapshot_invalid');
      references.push({ name: row.name, bytes: row.bytes });
    }
    return references;
  } catch { throw new CloudBackupError('snapshot_invalid'); }
}

export async function validateCompletedSnapshot(directory: string, sourceRoot: string, providers: SnapshotProviders = {
  lstat, readdir, realpath, references: readSnapshotReferences,
}): Promise<SnapshotFiles> {
  try {
    const owner = process.getuid?.();
    if (owner === undefined) throw new CloudBackupError('snapshot_invalid');
    const root = await providers.realpath(sourceRoot);
    const resolved = await providers.realpath(directory);
    if (!path.isAbsolute(directory) || resolved !== path.resolve(directory) || path.dirname(resolved) !== root
      || !/^cloud-run-\d{8}T\d{6}Z-\d+$/.test(path.basename(resolved))) throw new CloudBackupError('snapshot_invalid');
    for (const folder of [root, resolved]) {
      const info = await providers.lstat(folder);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== owner || (info.mode & 0o022) !== 0) throw new CloudBackupError('snapshot_invalid');
    }
    const entries = await providers.readdir(resolved);
    const databases = entries.filter((name) => /^app-\d{8}T\d{6}Z\.sqlite$/.test(name));
    if (databases.length !== 1) throw new CloudBackupError('snapshot_invalid');
    const database = databases[0];
    const evidenceDirectory = database.replace(/^app-/, 'evidence-').replace(/\.sqlite$/, '');
    if (entries.some((name) => name !== database && name !== evidenceDirectory)) throw new CloudBackupError('snapshot_invalid');
    const dbInfo = await providers.lstat(path.join(resolved, database));
    if (!dbInfo.isFile() || dbInfo.isSymbolicLink() || dbInfo.uid !== owner || (dbInfo.mode & 0o022) !== 0
      || dbInfo.nlink !== 1 || dbInfo.size <= 0 || dbInfo.size > MAX_SOURCE_BYTES) throw new CloudBackupError('snapshot_invalid');
    let sourceBytes = dbInfo.size;
    const expected = new Map<string, number>();
    let count = 0;
    for (const reference of await providers.references(path.join(resolved, database))) {
      if (++count > MAX_EVIDENCE_FILES || typeof reference.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(reference.name)
        || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || reference.bytes > MAX_SOURCE_BYTES
        || (expected.has(reference.name) && expected.get(reference.name) !== reference.bytes)) throw new CloudBackupError('snapshot_invalid');
      expected.set(reference.name, reference.bytes);
    }
    if (!entries.includes(evidenceDirectory)) {
      if (expected.size !== 0) throw new CloudBackupError('snapshot_invalid');
    } else {
      const folder = path.join(resolved, evidenceDirectory);
      const info = await providers.lstat(folder);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== owner || (info.mode & 0o022) !== 0) throw new CloudBackupError('snapshot_invalid');
      const actual = await providers.readdir(folder);
      if (actual.length !== expected.size) throw new CloudBackupError('snapshot_invalid');
      for (const name of actual) {
        if (!expected.has(name)) throw new CloudBackupError('snapshot_invalid');
        const file = await providers.lstat(path.join(folder, name));
        if (!file.isFile() || file.isSymbolicLink() || file.uid !== owner || (file.mode & 0o022) !== 0
          || file.nlink !== 1 || file.size !== expected.get(name)) throw new CloudBackupError('snapshot_invalid');
        sourceBytes += file.size;
        if (sourceBytes > MAX_SOURCE_BYTES) throw new CloudBackupError('archive_limit_exceeded');
      }
    }
    return { directory: resolved, entries: [database, ...(entries.includes(evidenceDirectory) ? [evidenceDirectory] : [])], sourceBytes };
  } catch (error) {
    throw error instanceof CloudBackupError ? error : new CloudBackupError('snapshot_invalid');
  }
}

export interface SnapshotArchive {
  stream: Readable;
  completion: Promise<void>;
  cancel: () => void;
}

export function createSnapshotArchive(snapshot: SnapshotFiles, signal: AbortSignal): SnapshotArchive {
  const gzip = createGzip({ level: 6 });
  const child = spawn('/usr/bin/tar', [
    '--format=ustar', '--numeric-owner', '--owner=0', '--group=0',
    '-cf', '-', '-C', snapshot.directory, '--', ...snapshot.entries,
  ], { stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  const cancel = () => {
    gzip.destroy(new CloudBackupError('archive_failed'));
    if (child.exitCode === null) child.kill('SIGKILL');
  };
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', () => { cancel(); reject(new CloudBackupError('archive_failed')); });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else { gzip.destroy(new CloudBackupError('archive_failed')); reject(new CloudBackupError('archive_failed')); }
    });
  });
  const completion = Promise.all([pipeline(child.stdout!, gzip, { signal }), exited]).then(() => undefined);
  void completion.catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  void completion.then(() => signal.removeEventListener('abort', cancel), () => signal.removeEventListener('abort', cancel));
  if (signal.aborted) cancel();
  return { stream: gzip, completion, cancel };
}
