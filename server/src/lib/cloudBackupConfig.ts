export const DEFAULT_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 10_000;
export const BLOCK_BYTES = 4 * 1024 * 1024;
export const CLOUD_BACKUP_TIMEOUT_MS = 10 * 60 * 1000;
export const CLOUD_RECEIPT_FILENAME = 'cloud-backup-success.json';

export class CloudBackupError extends Error {
  constructor(public readonly code: 'configuration_invalid' | 'snapshot_invalid' | 'archive_limit_exceeded' | 'archive_failed'
    | 'identity_unavailable' | 'upload_failed' | 'verification_failed' | 'timeout') {
    super(code);
  }
}

export interface CloudBackupConfig {
  account: string;
  container: string;
  managedIdentityClientId?: string;
  maxArchiveBytes: number;
}

export function cloudBackupConfig(env: NodeJS.ProcessEnv): CloudBackupConfig {
  const account = env.AZURE_BACKUP_ACCOUNT ?? '';
  const container = env.AZURE_BACKUP_CONTAINER ?? '';
  const managedIdentityClientId = env.AZURE_BACKUP_MANAGED_IDENTITY_CLIENT_ID || undefined;
  const configuredBytes = env.AZURE_BACKUP_MAX_BYTES;
  const maxArchiveBytes = configuredBytes === undefined || configuredBytes === '' ? DEFAULT_ARCHIVE_BYTES : Number(configuredBytes);
  if (env.AZURE_BACKUP_ENABLED !== 'true' || !/^[a-z0-9]{3,24}$/.test(account)
    || !/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/.test(container) || container.includes('--')
    || (managedIdentityClientId && !/^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$/.test(managedIdentityClientId))
    || (configuredBytes && !/^\d+$/.test(configuredBytes))
    || !Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 1024 * 1024 || maxArchiveBytes > MAX_ARCHIVE_BYTES) {
    throw new CloudBackupError('configuration_invalid');
  }
  return { account, container, managedIdentityClientId, maxArchiveBytes };
}
