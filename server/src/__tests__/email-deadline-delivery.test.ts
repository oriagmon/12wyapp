import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { EMAIL_SEND_TIMEOUT_MS } from '../lib/emailSender.js';

const sdk = vi.hoisted(() => ({
  beginSend: vi.fn(),
  pollUntilDone: vi.fn(),
  stopPolling: vi.fn(),
}));
vi.mock('@azure/communication-email', () => ({
  EmailClient: class { beginSend = sdk.beginSend; },
}));

beforeEach(() => {
  sdk.beginSend.mockReset();
  sdk.pollUntilDone.mockReset();
  sdk.stopPolling.mockReset();
  sdk.beginSend.mockResolvedValue({ pollUntilDone: sdk.pollUntilDone, stopPolling: sdk.stopPolling });
  sdk.pollUntilDone.mockResolvedValue({ status: 'Succeeded' });
  vi.stubEnv('ACS_EMAIL_CONNECTION_STRING', 'unused-mocked-connection');
  vi.stubEnv('EMAIL_SENDER_ADDRESS', 'sender@example.test');
  vi.stubEnv('APP_PUBLIC_URL', 'https://dashboard.example.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  closeDb();
});

describe('real sender deadline with in-memory WAM delivery (no Azure)', () => {
  it('releases the WAM completion lock on timeout, records unknown delivery as failure, and retries only that recipient', async () => {
    const app = freshApp();
    const first = await request(app).post('/api/auth/register').send({ email: 'first@example.test', password: 'test-password-123' });
    const second = await request(app).post('/api/auth/register').send({ email: 'second@example.test', password: 'test-password-123' });
    const cookie = extractCookie(first);
    const secondCookie = extractCookie(second);
    const me = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    await request(app).post('/api/partnerships/pair').set('Cookie', cookie).send({ targetUserId: me.body.id });
    const created = await request(app).post('/api/wams').set('Cookie', cookie).send({ week: 1 });
    const id = created.body.id as number;
    const nextWamAt = new Date(Date.now() + 86_400_000).toISOString();

    let entered!: (signal: AbortSignal) => void;
    const pollStarted = new Promise<AbortSignal>((resolve) => { entered = resolve; });
    sdk.pollUntilDone.mockImplementationOnce(({ abortSignal }: { abortSignal: AbortSignal }) => {
      entered(abortSignal);
      return new Promise<never>(() => {});
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const completing = request(app).post(`/api/wams/${id}/complete`).set('Cookie', cookie)
      .send({ nextWamAt }).then((response) => response);
    const signal = await pollStarted;
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    const failed = await completing;
    vi.useRealTimers();

    expect(signal.aborted).toBe(true);
    expect(failed.status).toBe(502);
    expect(failed.body.wam.status).toBe('draft');
    expect(failed.body.celebration).toBeUndefined();
    expect(sdk.beginSend).toHaveBeenCalledTimes(2);
    const deliveries = getDb().prepare(
      'SELECT status, error FROM wam_calendar_invitations WHERE wam_id = ? ORDER BY recipient_user_id'
    ).all(id) as { status: string; error: string | null }[];
    expect(deliveries[0]).toMatchObject({ status: 'failed' });
    expect(deliveries[0].error).toContain('timed out');
    expect(deliveries[0].error).toContain('delivery outcome is unknown');
    expect(deliveries[1]).toEqual({ status: 'sent', error: null });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM backup').get()).toEqual({ count: 0 });

    const retry = await request(app).post(`/api/wams/${id}/complete`).set('Cookie', cookie).send({ nextWamAt });
    expect(retry.status).toBe(200); // Not 409: the timeout released the per-WAM lock.
    expect(retry.body.wam.status).toBe('complete');
    expect(retry.body.celebration.type).toBe('completion');
    expect(sdk.beginSend).toHaveBeenCalledTimes(3);
    expect(sdk.beginSend.mock.calls[2][0].recipients.to[0].address).toBe('first@example.test');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM backup').get()).toEqual({ count: 1 });
  });
});
