import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb } from '../db.js';

describe('auth', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('registers a new user, sets an HttpOnly session cookie, and returns the email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'Alice@Example.com',
      password: 'correct horse battery staple',
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('alice@example.com');
    const cookieHeader = res.headers['set-cookie'][0] as string;
    expect(cookieHeader).toMatch(/HttpOnly/);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
    expect(cookieHeader).not.toMatch(/Secure/);
  });

  it('rejects duplicate email registration', async () => {
    await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'password123' });
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects weak/invalid input with clear errors', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('logs in with correct credentials and rejects wrong password without leaking which field was wrong', async () => {
    await request(app).post('/api/auth/register').send({ email: 'bob@a.com', password: 'password123' });
    const bad = await request(app).post('/api/auth/login').send({ email: 'bob@a.com', password: 'wrongpass' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/auth/login').send({ email: 'bob@a.com', password: 'password123' });
    expect(good.status).toBe(200);
  });

  it('me requires auth, logout clears the session', async () => {
    const reg = await request(app).post('/api/auth/register').send({ email: 'c@a.com', password: 'password123' });
    const cookie = extractCookie(reg);

    const unauth = await request(app).get('/api/auth/me');
    expect(unauth.status).toBe(401);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('c@a.com');

    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    const afterLogout = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });
});
