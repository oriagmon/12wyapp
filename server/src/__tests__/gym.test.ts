import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb } from '../db.js';

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123' });
  return { cookie: extractCookie(res), userId: res.body.id as number };
}

describe('gym: authentication', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  it('refuses every gym endpoint to a signed-out caller', async () => {
    const state = await request(app).get('/api/gym/state');
    expect(state.status).toBe(401);

    const weights = await request(app).get('/api/gym/weights');
    expect(weights.status).toBe(401);

    const save = await request(app)
      .post('/api/gym/weights')
      .send({ measuredOn: '2026-09-08', kg: 74.5 });
    expect(save.status).toBe(401);
  });
});

describe('gym: workout state', () => {
  let app: ReturnType<typeof freshApp>;
  let user: { cookie: string; userId: number };

  beforeEach(async () => {
    app = freshApp();
    user = await registerAndLogin(app, 'lifter@a.com');
  });

  it('starts empty, and reports the day so the client does not trust the device clock', async () => {
    const res = await request(app).get('/api/gym/state').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sessions: [], active: null });
    expect(res.body.updatedAt).toBeNull();
    expect(res.body.weights).toEqual([]);
    expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('round-trips a workout log without losing fields it does not model', async () => {
    const payload = {
      sessions: [
        {
          id: 'session-1',
          workoutId: 'A',
          startedAt: '2026-09-07T06:00:00.000Z',
          completedAt: '2026-09-07T07:00:00.000Z',
          sets: [
            {
              id: 'set-1',
              exerciseId: 'bench-press',
              setNumber: 1,
              weight: 60,
              reps: 10,
              rir: 2,
              completedAt: '2026-09-07T06:10:00.000Z',
            },
          ],
        },
      ],
      active: null,
    };

    const put = await request(app).put('/api/gym/state').set('Cookie', user.cookie).send(payload);
    expect(put.status).toBe(200);
    expect(put.body.updatedAt).toBeTruthy();

    const get = await request(app).get('/api/gym/state').set('Cookie', user.cookie);
    expect(get.body.data).toEqual(payload);
  });

  it('rejects a body that is not a workout log', async () => {
    const res = await request(app)
      .put('/api/gym/state')
      .set('Cookie', user.cookie)
      .send({ sessions: 'not-an-array', active: null });

    expect(res.status).toBe(400);
  });

  it('keeps one account\'s log invisible to another', async () => {
    await request(app)
      .put('/api/gym/state')
      .set('Cookie', user.cookie)
      .send({ sessions: [{ id: 'mine' }], active: null });

    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const res = await request(app).get('/api/gym/state').set('Cookie', stranger.cookie);

    expect(res.body.data).toEqual({ sessions: [], active: null });
  });
});

describe('gym: body weight', () => {
  let app: ReturnType<typeof freshApp>;
  let user: { cookie: string; userId: number };

  beforeEach(async () => {
    app = freshApp();
    user = await registerAndLogin(app, 'lifter@a.com');
  });

  it('records a weigh-in and returns the history oldest-first', async () => {
    await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-06', kg: 74.5, condition: 'before' });

    const res = await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-07', kg: 74.2, condition: 'after' });

    expect(res.status).toBe(201);
    expect(res.body.weights).toEqual([
      expect.objectContaining({ measuredOn: '2026-09-06', kg: 74.5, condition: 'before' }),
      expect.objectContaining({ measuredOn: '2026-09-07', kg: 74.2, condition: 'after' }),
    ]);
  });

  it('corrects the day rather than adding a second reading', async () => {
    await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 75.3, condition: 'before' });

    const res = await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 75.1, condition: 'after' });

    expect(res.body.weights).toHaveLength(1);
    expect(res.body.weights[0]).toMatchObject({ kg: 75.1, condition: 'after' });
  });

  it('accepts a reading with no condition recorded', async () => {
    const res = await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 74.9 });

    expect(res.status).toBe(201);
    expect(res.body.weights[0].condition).toBeNull();
  });

  it('rejects a weight that cannot be a person in kilograms', async () => {
    for (const kg of [0, 5, 900]) {
      const res = await request(app)
        .post('/api/gym/weights')
        .set('Cookie', user.cookie)
        .send({ measuredOn: '2026-09-08', kg });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a malformed date', async () => {
    const res = await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '08/09/2026', kg: 74.5 });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown condition', async () => {
    const res = await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 74.5, condition: 'sideways' });

    expect(res.status).toBe(400);
  });

  it('removes a reading', async () => {
    await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 74.5 });

    const res = await request(app)
      .delete('/api/gym/weights/2026-09-08')
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(res.body.weights).toEqual([]);

    const again = await request(app)
      .delete('/api/gym/weights/2026-09-08')
      .set('Cookie', user.cookie);
    expect(again.body.removed).toBe(false);
  });

  it('keeps one account\'s weigh-ins invisible to another', async () => {
    await request(app)
      .post('/api/gym/weights')
      .set('Cookie', user.cookie)
      .send({ measuredOn: '2026-09-08', kg: 74.5 });

    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const res = await request(app).get('/api/gym/weights').set('Cookie', stranger.cookie);

    expect(res.body.weights).toEqual([]);
  });
});

describe('gym: bundle', () => {
  it('serves the tracker bundle at /gym', async () => {
    const app = freshApp();
    const res = await request(app).get('/gym').redirects(1);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  it('does not let the dashboard catch-all swallow a deep gym link', async () => {
    const app = freshApp();
    const res = await request(app).get('/gym/anything').redirects(1);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });
});

afterAll(() => {
  closeDb();
});
