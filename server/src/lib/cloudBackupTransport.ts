import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { CloudBackupError } from './cloudBackupConfig.js';

export interface CloudRequest {
  url: URL;
  method: 'GET' | 'PUT' | 'HEAD';
  headers: Record<string, string>;
  body?: Buffer;
  signal: AbortSignal;
}
export interface CloudResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}
export type CloudTransport = (request: CloudRequest) => Promise<CloudResponse>;

/** No redirects or proxies: only Azure public Blob HTTPS and the fixed VM IMDS endpoint. */
export const boundedCloudRequest: CloudTransport = (input) => {
  const imds = input.url.protocol === 'http:' && input.url.hostname === '169.254.169.254'
    && input.url.pathname === '/metadata/identity/oauth2/token' && input.method === 'GET';
  const blob = input.url.protocol === 'https:' && /^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(input.url.hostname);
  if ((!imds && !blob) || input.url.username || input.url.password || input.url.port) return Promise.reject(new CloudBackupError('configuration_invalid'));
  return new Promise((resolve, reject) => {
    const fail = () => reject(new CloudBackupError(input.signal.aborted ? 'timeout' : imds ? 'identity_unavailable' : 'upload_failed'));
    const request = (imds ? http : https).request(input.url, {
      method: input.method, headers: input.headers, signal: input.signal,
      agent: false, timeout: imds ? 5000 : 30_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) { response.destroy(); request.destroy(); fail(); }
        else chunks.push(chunk);
      });
      response.once('error', fail);
      response.once('aborted', fail);
      response.once('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    const wallTimeout = setTimeout(() => { request.destroy(); fail(); }, imds ? 5000 : 30_000);
    wallTimeout.unref();
    request.once('close', () => clearTimeout(wallTimeout));
    request.once('error', fail);
    request.once('timeout', () => { request.destroy(); fail(); });
    request.end(input.body);
  });
};
