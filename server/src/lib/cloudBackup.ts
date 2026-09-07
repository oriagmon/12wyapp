import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { SnapshotArchive } from './cloudBackupSnapshot.js';
import { BLOCK_BYTES, CloudBackupError, type CloudBackupConfig } from './cloudBackupConfig.js';
import { boundedCloudRequest, type CloudRequest, type CloudResponse, type CloudTransport } from './cloudBackupTransport.js';

export interface CloudUploadProviders {
  request: CloudTransport;
  now: () => Date;
  uuid: () => string;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
const defaults: CloudUploadProviders = {
  request: boundedCloudRequest, now: () => new Date(), uuid: randomUUID,
  sleep: async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }); },
};
const transient = new Set([408, 429, 500, 502, 503, 504]);
const md5 = (value: Buffer) => createHash('md5').update(value).digest('base64');

export async function uploadSnapshotArchive(
  config: CloudBackupConfig, archive: SnapshotArchive, signal: AbortSignal, providers: CloudUploadProviders = defaults,
): Promise<{ completedAt: string; archiveBytes: number }> {
  let accessToken: { value: string; expiresAt: number } | null = null;
  const endpoint = new URL(`https://${config.account}.blob.core.windows.net/${config.container}/`);
  const startedAt = providers.now().toISOString();
  const blob = new URL(`daily/${startedAt.slice(0, 4)}/${startedAt.slice(5, 7)}/${startedAt.slice(8, 10)}/${startedAt.replace(/[:.]/g, '-')}-${providers.uuid()}.tar.gz`, endpoint);

  async function backoff(attempt: number, response?: CloudResponse) {
    const seconds = Number(response?.headers['retry-after']);
    const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 5000) : 500 * 2 ** attempt;
    await providers.sleep(wait, signal);
  }
  async function token(): Promise<string> {
    if (accessToken && accessToken.expiresAt > providers.now().getTime() + 120_000) return accessToken.value;
    const url = new URL('http://169.254.169.254/metadata/identity/oauth2/token');
    url.searchParams.set('api-version', '2018-02-01');
    url.searchParams.set('resource', 'https://storage.azure.com/');
    if (config.managedIdentityClientId) url.searchParams.set('client_id', config.managedIdentityClientId);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: CloudResponse | undefined;
      try { response = await providers.request({ url, method: 'GET', headers: { Metadata: 'true' }, signal }); } catch { /* bounded retry */ }
      if (signal.aborted) throw new CloudBackupError('timeout');
      if (response?.status === 200) {
        try {
          const body = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
          const expiresAt = Number(body.expires_on) * 1000;
          if (body.token_type !== 'Bearer' || typeof body.access_token !== 'string' || !/^[A-Za-z0-9._~-]{20,16384}$/.test(body.access_token)
            || !Number.isSafeInteger(expiresAt) || expiresAt <= providers.now().getTime() + 120_000
            || (body.resource !== undefined && body.resource !== 'https://storage.azure.com/')) throw new Error('invalid_identity_response');
          accessToken = { value: body.access_token, expiresAt };
          return accessToken.value;
        } catch { throw new CloudBackupError('identity_unavailable'); }
      }
      if (attempt === 2 || (response && !transient.has(response.status))) throw new CloudBackupError('identity_unavailable');
      await backoff(attempt, response);
    }
    throw new CloudBackupError('identity_unavailable');
  }
  async function blobRequest(method: 'PUT' | 'HEAD', url: URL, body?: Buffer, headers: Record<string, string> = {}): Promise<CloudResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new CloudBackupError('timeout');
      const request: CloudRequest = {
        url, method, body, signal,
        headers: {
          Authorization: `Bearer ${await token()}`, 'x-ms-version': '2023-11-03',
          'x-ms-date': providers.now().toUTCString(), 'x-ms-client-request-id': providers.uuid(),
          ...(body ? { 'Content-Length': String(body.length), 'Content-MD5': md5(body) } : {}),
          ...headers,
        },
      };
      let response: CloudResponse | undefined;
      try { response = await providers.request(request); } catch { /* bounded retry */ }
      if (signal.aborted) throw new CloudBackupError('timeout');
      if (response && !transient.has(response.status) && response.status !== 401) return response;
      if (response?.status === 401) accessToken = null;
      if (attempt === 2) throw new CloudBackupError('upload_failed');
      await backoff(attempt, response);
    }
    throw new CloudBackupError('upload_failed');
  }

  try {
    const hash = createHash('sha256');
    let bytes = 0;
    const blocks: string[] = [];
    let parts: Buffer[] = [];
    let pendingBytes = 0;
    async function uploadBlock(buffer: Buffer) {
      const blockId = Buffer.from(String(blocks.length).padStart(6, '0')).toString('base64');
      const url = new URL(blob);
      url.searchParams.set('comp', 'block');
      url.searchParams.set('blockid', blockId);
      const response = await blobRequest('PUT', url, buffer);
      if (response.status !== 201) throw new CloudBackupError('upload_failed');
      blocks.push(blockId);
    }
    for await (const value of archive.stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      bytes += chunk.length;
      if (bytes > config.maxArchiveBytes) throw new CloudBackupError('archive_limit_exceeded');
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) {
        const length = Math.min(BLOCK_BYTES - pendingBytes, chunk.length - offset);
        parts.push(chunk.subarray(offset, offset + length));
        pendingBytes += length;
        offset += length;
        if (pendingBytes === BLOCK_BYTES) {
          await uploadBlock(Buffer.concat(parts, pendingBytes));
          parts = [];
          pendingBytes = 0;
        }
      }
    }
    await archive.completion;
    if (bytes === 0) throw new CloudBackupError('archive_failed');
    if (pendingBytes) await uploadBlock(Buffer.concat(parts, pendingBytes));
    const digest = hash.digest('hex');
    const blockList = Buffer.from(`<?xml version="1.0" encoding="utf-8"?><BlockList>${blocks.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`);
    const commitUrl = new URL(blob);
    commitUrl.searchParams.set('comp', 'blocklist');
    const commit = await blobRequest('PUT', commitUrl, blockList, {
      'Content-Type': 'application/xml', 'x-ms-blob-content-type': 'application/gzip',
      'x-ms-meta-sha256': digest, 'x-ms-meta-backupformat': 'sqlite-evidence-tar-gzip-v1',
      'x-ms-access-tier': 'Hot', 'If-None-Match': '*',
    });
    // A retry after a lost commit response may find our already-committed unique blob.
    if (commit.status !== 201 && commit.status !== 412) throw new CloudBackupError('upload_failed');
    const confirmed = await blobRequest('HEAD', blob);
    if (confirmed.status !== 200 || Number(confirmed.headers['content-length']) !== bytes
      || confirmed.headers['x-ms-meta-sha256'] !== digest || confirmed.headers['x-ms-blob-type'] !== 'BlockBlob'
      || confirmed.headers['x-ms-meta-backupformat'] !== 'sqlite-evidence-tar-gzip-v1') throw new CloudBackupError('verification_failed');
    return { completedAt: providers.now().toISOString(), archiveBytes: bytes };
  } catch (error) {
    archive.cancel();
    throw error instanceof CloudBackupError ? error : new CloudBackupError(signal.aborted ? 'timeout' : 'upload_failed');
  } finally {
    accessToken = null;
  }
}
