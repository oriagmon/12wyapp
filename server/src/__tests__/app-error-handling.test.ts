import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb } from '../db.js';

/**
 * Isolated coverage of the centralized 413 (payload-too-large) error handler in app.ts:
 * the avatar upload route must keep its specific "2MB image" wording, while every other
 * oversized request (generic JSON bodies, capped by express.json()'s 200kb limit) gets a
 * generic Hebrew "request too large" message instead — the two must never be conflated.
 */
describe('app-level 413 (payload too large) handling', () => {
  let app: ReturnType<typeof freshApp>;
  let cookie: string;

  beforeEach(async () => {
    app = freshApp();
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'password123' });
    cookie = extractCookie(res);
  });

  afterAll(() => closeDb());

  it('an oversized avatar upload gets the specific 2MB image message', async () => {
    // Spoof a Content-Length above the limit while sending only a tiny real body — efficient
    // and deterministic (no large-payload write race between client and server).
    const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', cookie)
      .set('Content-Type', 'image/png')
      .set('Content-Length', String(2 * 1024 * 1024 + 1))
      .send(tinyPng);
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('התמונה גדולה מדי — הגודל המרבי הוא 2MB');
  });

  it('an oversized generic JSON request gets a generic "request too large" message, never the avatar wording', async () => {
    const res = await request(app)
      .patch('/api/profile')
      .set('Cookie', cookie)
      .send({ bio: 'א'.repeat(250 * 1024) }); // well past express.json()'s 200kb cap
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('הבקשה גדולה מדי');
    expect(res.body.error).not.toMatch(/תמונה|2MB/);
  });
});
