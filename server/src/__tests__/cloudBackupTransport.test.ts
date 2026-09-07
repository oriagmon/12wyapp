import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ClientRequest, type RequestOptions } from 'node:http';
import https from 'node:https';
import { boundedCloudRequest } from '../lib/cloudBackupTransport.js';

vi.mock('node:http', () => ({ default: { request: vi.fn() } }));
vi.mock('node:https', () => ({ default: { request: vi.fn() } }));

function installResponse(status: number, bytes: Buffer) {
  const mocked = (_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
    const request = new EventEmitter() as ClientRequest;
    const response = Object.assign(new EventEmitter(), { statusCode: status, headers: { location: 'https://unapproved.example/' } }) as IncomingMessage;
    request.destroy = vi.fn(() => { request.emit('close'); return request; });
    response.destroy = vi.fn(() => { request.emit('close'); return response; });
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        callback(response);
        response.emit('data', bytes);
        response.emit('end');
        request.emit('close');
      });
      return request;
    }) as ClientRequest['end'];
    return request;
  };
  vi.mocked(http.request).mockImplementation(mocked as typeof http.request);
  vi.mocked(https.request).mockImplementation(mocked as typeof https.request);
}

describe('native cloud transport with fully mocked sockets', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([
    'http://example.com/', 'https://example.com/', 'http://fixtureaccount.blob.core.windows.net/',
    'https://fixtureaccount.blob.core.windows.net:444/', 'https://user:password@fixtureaccount.blob.core.windows.net/',
    'http://169.254.169.254/not-the-identity-endpoint',
  ])('rejects an unapproved target before any socket: %s', async (url) => {
    await expect(boundedCloudRequest({ url: new URL(url), method: 'GET', headers: {}, signal: new AbortController().signal })).rejects.toThrow('configuration_invalid');
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });
  it('returns redirects without following them and bounds native request timeouts', async () => {
    installResponse(302, Buffer.from('redirect fixture'));
    const result = await boundedCloudRequest({
      url: new URL('https://fixtureaccount.blob.core.windows.net/private-backups/daily/fixture'),
      method: 'PUT', headers: {}, body: Buffer.from('fixture'), signal: new AbortController().signal,
    });
    expect(result.status).toBe(302);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(https.request).mock.calls[0][1]).toMatchObject({ timeout: 30000, agent: false });
    expect(http.request).not.toHaveBeenCalled();
  });
  it('rejects oversized responses instead of retaining provider diagnostics', async () => {
    installResponse(500, Buffer.alloc(65537));
    await expect(boundedCloudRequest({
      url: new URL('https://fixtureaccount.blob.core.windows.net/private-backups/daily/fixture'),
      method: 'PUT', headers: {}, signal: new AbortController().signal,
    })).rejects.toThrow(/^upload_failed$/);
  });
  it('permits only the fixed IMDS endpoint with its shorter timeout', async () => {
    installResponse(200, Buffer.from('{}'));
    await boundedCloudRequest({
      url: new URL('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01'),
      method: 'GET', headers: { Metadata: 'true' }, signal: new AbortController().signal,
    });
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(http.request).mock.calls[0][1]).toMatchObject({ timeout: 5000, agent: false });
    expect(https.request).not.toHaveBeenCalled();
  });
});
