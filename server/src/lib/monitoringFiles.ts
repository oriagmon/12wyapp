import { constants } from 'node:fs';
import { open, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLOUD_RECEIPT_FILENAME } from './cloudBackupConfig.js';

export const MAX_PROBE_BYTES = 16 * 1024;
export const PROBE_FILENAME = 'monitoring-probe.json';
export const BACKUP_RECEIPT_FILENAME = 'file-backup-success.json';

export class MonitoringFileError extends Error {
  constructor(public readonly code: 'oversized' | 'unavailable') {
    super(code);
  }
}

export async function readBoundedFile(filename: string, limit: number): Promise<Buffer> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new MonitoringFileError('unavailable');
    if (stat.size > limit) throw new MonitoringFileError('oversized');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new MonitoringFileError('oversized');
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

/** State directory must already exist, owned by the probe operator and not app-writable. */
export async function writeAtomicJson(directory: string, filename: string, value: unknown): Promise<void> {
  if (filename !== PROBE_FILENAME && filename !== BACKUP_RECEIPT_FILENAME && filename !== CLOUD_RECEIPT_FILENAME) throw new Error('invalid_output');
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0) throw new Error('invalid_state_directory');
  const content = Buffer.from(JSON.stringify(value) + '\n');
  if (content.length > MAX_PROBE_BYTES) throw new MonitoringFileError('oversized');
  const staging = path.join(directory, `.monitoring-${randomUUID()}.partial`);
  const destination = path.join(directory, filename);
  const file = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
  try {
    await file.writeFile(content);
    await file.chmod(0o640);
    await file.sync();
    await file.close();
    await rename(staging, destination);
    const dir = await open(directory, constants.O_RDONLY);
    try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(staging).catch(() => undefined);
    throw error;
  }
}
