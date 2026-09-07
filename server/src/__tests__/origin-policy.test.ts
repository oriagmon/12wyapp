import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { config, getAllowedRequestOrigins } from '../config.js';
import { freshApp } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { createSession } from '../lib/sessions.js';

const SITE = 'https://app.example.test';
const originalNodeEnv = config.nodeEnv;
beforeEach(() => {
  config.nodeEnv = 'production';
  vi.stubEnv('APP_ALLOWED_USER_IDS', '1');
  vi.stubEnv('APP_PUBLIC_URL', SITE);
});
afterEach(() => {
  closeDb();
  config.nodeEnv = originalNodeEnv;
  vi.unstubAllEnvs();
});

function fixture() {
  const app = freshApp();
  getDb().prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)').run('owner@example.test', 'unused-in-this-test');
  const cookie = `session_token=${createSession(getDb(), 1).token}`;
  return { app, cookie };
}

describe('exact origin CORS and state-changing request guard', () => {
  it.each([
    'https://evil.example.test', // Same-site HTTPS sibling: SameSite=Lax is NOT a defense.
    'https://app.example.test.evil.test', 'https://another.cloudapp.azure.com',
    'https://unrelated.test', 'http://app.example.test', 'https://app.example.test:444',
    'null', 'not-an-origin', `${SITE}/`, `${SITE} https://evil.example.test`,
  ])('rejects unsafe requests with origin %s even when a valid victim cookie is supplied', async (origin) => {
    const { app, cookie } = fixture();
    const response = await request(app).patch('/api/profile').set('Cookie', cookie)
      .set('Origin', origin).send({ displayName: 'attacker update' });
    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(getDb().prepare('SELECT display_name FROM users WHERE id = 1').get()).toEqual({ display_name: '' });
  });

  it('blocks a simple form POST without preflight as well as private reads', async () => {
    const { app, cookie } = fixture();
    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie)
      .set('Origin', 'https://evil.example.test').type('form').send({});
    expect(logout.status).toBe(403);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    const profile = await request(app).get('/api/profile').set('Cookie', cookie).set('Origin', 'https://evil.example.test');
    expect(profile.status).toBe(403);
    expect(profile.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the exact legitimate origin, preserves authentication and data flow, and does not trust Host headers', async () => {
    const { app, cookie } = fixture();
    const unauth = await request(app).get('/api/profile').set('Origin', SITE);
    expect(unauth.status).toBe(401);
    const update = await request(app).patch('/api/profile').set('Cookie', cookie)
      .set('Origin', SITE).send({ displayName: 'Legitimate update' });
    expect(update.status).toBe(200);
    expect(update.headers['access-control-allow-origin']).toBe(SITE);
    expect(update.headers['access-control-allow-credentials']).toBe('true');
    expect(update.headers.vary).toContain('Origin');
    const profile = await request(app).get('/api/profile').set('Cookie', cookie).set('Origin', SITE);
    expect(profile.body.displayName).toBe('Legitimate update');
    const forged = await request(app).post('/api/auth/logout').set('Cookie', cookie)
      .set('Host', 'evil.example.test').set('X-Forwarded-Host', 'evil.example.test')
      .set('Origin', 'https://evil.example.test');
    expect(forged.status).toBe(403);
  });

  it('allows only legitimate preflights, including binary evidence upload headers', async () => {
    const app = freshApp();
    const allowed = await request(app).options('/api/tactic-evidence/1/1/0/file')
      .set('Origin', SITE).set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type,x-evidence-filename');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(SITE);
    expect(allowed.headers['access-control-allow-methods']).toContain('PUT');
    expect(allowed.headers['access-control-allow-headers'].toLowerCase()).toContain('x-evidence-filename');
    const blocked = await request(app).options('/api/profile').set('Origin', 'https://evil.example.test')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(blocked.status).toBe(403);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get('/api/profile').set('Origin', SITE)).status).toBe(401);
  });

  it('preserves origin-less health/CLI requests but rejects missing-Origin unsafe browser requests from other sites', async () => {
    const { app, cookie } = fixture();
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get('/api/profile').set('Cookie', cookie)).status).toBe(200);
    for (const site of ['same-site', 'cross-site']) {
      expect((await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Sec-Fetch-Site', site)).status).toBe(403);
    }
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
  });

  it('retains only exact loopback dev origins outside production', async () => {
    config.nodeEnv = 'development';
    vi.stubEnv('APP_ALLOWED_USER_IDS', undefined);
    vi.stubEnv('APP_PUBLIC_URL', undefined);
    const app = freshApp();
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', `http://127.0.0.1:${config.port}`]) {
      const response = await request(app).options('/api/profile').set('Origin', origin).set('Access-Control-Request-Method', 'PATCH');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
    expect((await request(app).post('/api/auth/logout').set('Origin', 'http://localhost.evil.test:5173')).status).toBe(403);
    expect((await request(app).post('/api/auth/logout').set('Origin', 'http://localhost:9876')).status).toBe(403);
  });

  it.each([undefined, '', 'not a URL', 'http://app.example.test', 'ftp://app.example.test',
    'https://user:pass@app.example.test', 'https://*.example.test', 'https://app.example.test\n.evil.test'])(
    'fails production startup for an invalid public URL: %s', (value) => {
      vi.stubEnv('APP_PUBLIC_URL', value);
      expect(() => getAllowedRequestOrigins()).toThrow(/APP_PUBLIC_URL/);
      expect(() => freshApp()).toThrow(/APP_PUBLIC_URL/);
    }
  );
});
