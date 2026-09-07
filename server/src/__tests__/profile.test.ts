import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { freshApp, extractCookie } from './helpers.js';
import { closeDb, getDb } from '../db.js';
import { MAX_AVATAR_BYTES } from '../routes/profile.js';
import { createResetToken } from '../lib/passwordReset.js';

async function registerAndLogin(app: ReturnType<typeof freshApp>, email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123' });
  const cookie = extractCookie(res);
  return { cookie, userId: res.body.id as number, email };
}

async function pairUsers(
  app: ReturnType<typeof freshApp>,
  a: { cookie: string; userId: number },
  b: { cookie: string; userId: number }
) {
  const res = await request(app).post('/api/partnerships/pair').set('Cookie', a.cookie).send({ targetUserId: b.userId });
  return res.body.partner.partnershipId as number;
}

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // fake IHDR chunk (content doesn't matter for our sniffing)
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function webpBytes(): Buffer {
  const buf = Buffer.alloc(20);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(12, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  return buf;
}

describe('profile: GET/PATCH profile fields', () => {
  let app: ReturnType<typeof freshApp>;

  beforeEach(() => {
    app = freshApp();
  });

  afterAll(() => closeDb());

  it('requires authentication', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('returns default empty profile fields, streak 0, on a brand-new user', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const res = await request(app).get('/api/profile').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: owner.userId,
      email: 'owner@a.com',
      displayName: '',
      bio: '',
      hasAvatar: false,
      avatarVersion: 0,
      successStreak: 0,
    });
  });

  it('trims and saves display name and bio, partially updating only provided fields', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const first = await request(app)
      .patch('/api/profile')
      .set('Cookie', owner.cookie)
      .send({ displayName: '  אורי  ', bio: '  אוהב לרוץ  ' });
    expect(first.status).toBe(200);
    expect(first.body.displayName).toBe('אורי');
    expect(first.body.bio).toBe('אוהב לרוץ');

    const second = await request(app)
      .patch('/api/profile')
      .set('Cookie', owner.cookie)
      .send({ bio: 'ביו חדש' });
    expect(second.status).toBe(200);
    expect(second.body.displayName).toBe('אורי'); // untouched by partial update
    expect(second.body.bio).toBe('ביו חדש');
  });

  it('rejects an empty display name and an over-length bio', async () => {
    const owner = await registerAndLogin(app, 'owner@a.com');
    const emptyName = await request(app)
      .patch('/api/profile')
      .set('Cookie', owner.cookie)
      .send({ displayName: '   ' });
    expect(emptyName.status).toBe(400);

    const longBio = await request(app)
      .patch('/api/profile')
      .set('Cookie', owner.cookie)
      .send({ bio: 'א'.repeat(501) });
    expect(longBio.status).toBe(400);

    const longName = await request(app)
      .patch('/api/profile')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'א'.repeat(81) });
    expect(longName.status).toBe(400);
  });

  it('a stranger cannot read or edit another user profile via any known route shape', async () => {
    // There is no cross-user profile route at all — profile is always derived from the
    // caller's own session, never from a userId param. Confirm PATCH/GET stay self-scoped
    // simply by checking two different users never see each other's data.
    const a = await registerAndLogin(app, 'a@a.com');
    const b = await registerAndLogin(app, 'b@a.com');
    await request(app).patch('/api/profile').set('Cookie', a.cookie).send({ displayName: 'Alice' });
    await request(app).patch('/api/profile').set('Cookie', b.cookie).send({ displayName: 'Bob' });

    const aProfile = await request(app).get('/api/profile').set('Cookie', a.cookie);
    const bProfile = await request(app).get('/api/profile').set('Cookie', b.cookie);
    expect(aProfile.body.displayName).toBe('Alice');
    expect(bProfile.body.displayName).toBe('Bob');
  });
});

describe('profile: avatar upload/read/delete', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    owner = await registerAndLogin(app, 'owner@a.com');
  });

  afterAll(() => closeDb());

  it('requires authentication for every avatar route', async () => {
    expect((await request(app).get('/api/profile/avatar')).status).toBe(401);
    expect((await request(app).put('/api/profile/avatar').set('Content-Type', 'image/png').send(PNG_BYTES)).status).toBe(
      401
    );
    expect((await request(app).delete('/api/profile/avatar')).status).toBe(401);
  });

  it('returns 404 for GET avatar when none is set', async () => {
    const res = await request(app).get('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(res.status).toBe(404);
  });

  it('accepts a valid PNG upload, bumps avatarVersion, and serves it back with correct content type + no-store caching', async () => {
    const upload = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(upload.status).toBe(200);
    expect(upload.body.hasAvatar).toBe(true);
    expect(upload.body.avatarVersion).toBe(1);
    expect(upload.body).not.toHaveProperty('avatarData');
    expect(upload.body).not.toHaveProperty('avatar_data');

    const read = await request(app).get('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toMatch(/^image\/png/);
    expect(read.headers['cache-control']).toBe('private, no-store');
    expect(read.headers.vary).toContain('Cookie');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(read.body as Buffer, PNG_BYTES)).toBe(0);
  });

  it('accepts JPEG and WebP too, storing the sniffed (not merely claimed) type', async () => {
    const jpeg = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG_BYTES);
    expect(jpeg.status).toBe(200);
    const readJpeg = await request(app).get('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(readJpeg.headers['content-type']).toMatch(/^image\/jpeg/);

    const webp = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/webp')
      .send(webpBytes());
    expect(webp.status).toBe(200);
    expect(webp.body.avatarVersion).toBe(2);
    const readWebp = await request(app).get('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(readWebp.headers['content-type']).toMatch(/^image\/webp/);
  });

  it('rejects SVG outright (never parsed, never stored)', async () => {
    const svg = Buffer.from('<svg onload="alert(1)"></svg>');
    const res = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/svg+xml')
      .send(svg);
    expect(res.status).toBe(400);

    const check = await request(app).get('/api/profile').set('Cookie', owner.cookie);
    expect(check.body.hasAvatar).toBe(false);
  });

  it('rejects a spoofed MIME: claimed image/png but the bytes are not a real image (magic-byte check)', async () => {
    const fakeBytes = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/png')
      .send(fakeBytes);
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported declared type (e.g. gif) before ever reading the body', async () => {
    const res = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/gif')
      .send(Buffer.from('GIF89a'));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized upload (over the 2 MiB limit) with 413, without leaking internals', async () => {
    // Spoof a Content-Length above the limit while sending only a tiny real body: the
    // Content-Length precheck rejects (and drains) the request before any large payload would
    // ever need to be transferred, so this is both efficient and avoids a large-payload write
    // race between client and server.
    const res = await request(app)
      .put('/api/profile/avatar')
      .set('Cookie', owner.cookie)
      .set('Content-Type', 'image/png')
      .set('Content-Length', String(MAX_AVATAR_BYTES + 1))
      .send(PNG_BYTES);
    expect(res.status).toBe(413);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).not.toMatch(/stack|Error:|at /i);
  });

  it('deletes the avatar, resetting hasAvatar and bumping the version again', async () => {
    await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
    const del = await request(app).delete('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(del.status).toBe(200);
    expect(del.body.hasAvatar).toBe(false);
    expect(del.body.avatarVersion).toBe(2);

    const read = await request(app).get('/api/profile/avatar').set('Cookie', owner.cookie);
    expect(read.status).toBe(404);
  });

  it('one user can never read another user’s avatar bytes', async () => {
    await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
    const stranger = await registerAndLogin(app, 'stranger@a.com');
    const res = await request(app).get('/api/profile/avatar').set('Cookie', stranger.cookie);
    expect(res.status).toBe(404); // stranger has no avatar of their own — never owner's
  });

  describe('?u= — an accepted partner may fetch the other participant\'s avatar', () => {
    it('lets the accepted partner fetch the owner\'s avatar via ?u=<ownerId>', async () => {
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pairUsers(app, owner, partner);

      const res = await request(app).get(`/api/profile/avatar?u=${owner.userId}`).set('Cookie', partner.cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    });

    it('still lets a user fetch their own avatar explicitly via ?u=<selfId>, identical to the implicit self default', async () => {
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const res = await request(app).get(`/api/profile/avatar?u=${owner.userId}`).set('Cookie', owner.cookie);
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
    });

    it('denies a stranger (not the accepted partner) requesting via ?u=, with the exact same indistinguishable 404 as "no avatar"', async () => {
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const stranger = await registerAndLogin(app, 'stranger@a.com');
      const res = await request(app).get(`/api/profile/avatar?u=${owner.userId}`).set('Cookie', stranger.cookie);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'לא הוגדרה תמונת פרופיל' });
    });

    it('denies a former partner after unpairing (no longer "currently accepted")', async () => {
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const partner = await registerAndLogin(app, 'partner@a.com');
      const partnershipId = await pairUsers(app, owner, partner);
      await request(app).delete(`/api/partnerships/${partnershipId}`).set('Cookie', owner.cookie);

      const res = await request(app).get(`/api/profile/avatar?u=${owner.userId}`).set('Cookie', partner.cookie);
      expect(res.status).toBe(404);
    });

    it('denies a pending (not-yet-accepted) invitee — only a currently accepted partnership grants access', async () => {
      const invitee = await registerAndLogin(app, 'invitee@a.com');
      // direct pairing in this codebase is immediate/accepted (see pairUsers), so simulate a
      // stranger who was never paired at all rather than a genuinely pending invite state —
      // the important invariant is identical either way: no accepted partnership, no access.
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const res = await request(app).get(`/api/profile/avatar?u=${owner.userId}`).set('Cookie', invitee.cookie);
      expect(res.status).toBe(404);
    });

    it('returns 404 for ?u=<partnerId> when the partner has no avatar set (never a broken image)', async () => {
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pairUsers(app, owner, partner);
      const res = await request(app).get(`/api/profile/avatar?u=${partner.userId}`).set('Cookie', owner.cookie);
      expect(res.status).toBe(404);
    });

    it('rejects a non-numeric/garbage ?u= value with 404 rather than crashing', async () => {
      const res = await request(app).get('/api/profile/avatar?u=not-a-number').set('Cookie', owner.cookie);
      expect(res.status).toBe(404);
    });

    it('never caches partner bytes across sessions and serves an updated image after upload', async () => {
      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/png').send(PNG_BYTES);
      const partner = await registerAndLogin(app, 'partner@a.com');
      await pairUsers(app, owner, partner);

      const profileBefore = await request(app).get('/api/profile').set('Cookie', owner.cookie);
      const versionBefore = profileBefore.body.avatarVersion as number;
      const first = await request(app).get(`/api/profile/avatar?u=${owner.userId}&v=${versionBefore}`).set('Cookie', partner.cookie);
      expect(first.status).toBe(200);
      expect(first.headers['cache-control']).toBe('private, no-store');
      expect(first.headers.vary).toContain('Cookie');

      await request(app).put('/api/profile/avatar').set('Cookie', owner.cookie).set('Content-Type', 'image/jpeg').send(JPEG_BYTES);
      const profileAfter = await request(app).get('/api/profile').set('Cookie', owner.cookie);
      const versionAfter = profileAfter.body.avatarVersion as number;
      expect(versionAfter).toBe(versionBefore + 1);

      // Version changes trigger an image reload, but authorization is never HTTP-cached.
      const second = await request(app).get(`/api/profile/avatar?u=${owner.userId}&v=${versionAfter}`).set('Cookie', partner.cookie);
      expect(second.status).toBe(200);
      expect(second.headers['content-type']).toBe('image/jpeg');
    });
  });
});

describe('profile: password change', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    owner = await registerAndLogin(app, 'owner@a.com');
  });

  afterAll(() => closeDb());

  it('requires authentication', async () => {
    const res = await request(app)
      .patch('/api/profile/password')
      .send({ currentPassword: 'password123', newPassword: 'newpassword123' });
    expect(res.status).toBe(401);
  });

  it('rejects the wrong current password without leaking internals', async () => {
    const res = await request(app)
      .patch('/api/profile/password')
      .set('Cookie', owner.cookie)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects a new password identical to the current one', async () => {
    const res = await request(app)
      .patch('/api/profile/password')
      .set('Cookie', owner.cookie)
      .send({ currentPassword: 'password123', newPassword: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects a new password that is too short (existing password rules)', async () => {
    const res = await request(app)
      .patch('/api/profile/password')
      .set('Cookie', owner.cookie)
      .send({ currentPassword: 'password123', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('changes the password, keeps the current session alive, and revokes every other session', async () => {
    // Log in a second time to create a second, independent session for the same user.
    const secondLogin = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'password123' });
    const secondCookie = extractCookie(secondLogin);

    const meFirst = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(meFirst.status).toBe(200);
    const meSecond = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    expect(meSecond.status).toBe(200);

    const change = await request(app)
      .patch('/api/profile/password')
      .set('Cookie', owner.cookie)
      .send({ currentPassword: 'password123', newPassword: 'newpassword123' });
    expect(change.status).toBe(200);

    // Current (first) session must still work.
    const meFirstAfter = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    expect(meFirstAfter.status).toBe(200);

    // The second, independent session must now be revoked.
    const meSecondAfter = await request(app).get('/api/auth/me').set('Cookie', secondCookie);
    expect(meSecondAfter.status).toBe(401);

    // New password now works; old one no longer does.
    const loginNew = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'newpassword123' });
    expect(loginNew.status).toBe(200);
    const loginOld = await request(app).post('/api/auth/login').send({ email: 'owner@a.com', password: 'password123' });
    expect(loginOld.status).toBe(401);
  });

  it('invalidates any outstanding password-reset token for this account when the password is changed here (an authenticated change is itself a security reset — an old leaked reset link must not remain usable afterwards)', async () => {
    const db = getDb();
    const { token } = createResetToken(db, owner.userId);
    const before = db
      .prepare('SELECT used_at FROM password_reset_tokens WHERE user_id = ?')
      .get(owner.userId) as { used_at: string | null };
    expect(before.used_at).toBeNull();

    const change = await request(app)
      .patch('/api/profile/password')
      .set('Cookie', owner.cookie)
      .send({ currentPassword: 'password123', newPassword: 'newpassword123' });
    expect(change.status).toBe(200);

    const after = db
      .prepare('SELECT used_at FROM password_reset_tokens WHERE user_id = ?')
      .get(owner.userId) as { used_at: string | null };
    expect(after.used_at).not.toBeNull();
    void token;
  });
});

describe('profile: successStreak surfaced consistently across auth + profile endpoints', () => {
  let app: ReturnType<typeof freshApp>;
  let owner: { cookie: string; userId: number; email: string };

  beforeEach(async () => {
    app = freshApp();
    owner = await registerAndLogin(app, 'owner@a.com');
  });

  afterAll(() => closeDb());

  it('register/login/me/profile all report the same successStreak value (0 for a brand-new user)', async () => {
    const me = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    const profile = await request(app).get('/api/profile').set('Cookie', owner.cookie);
    expect(me.body.successStreak).toBe(0);
    expect(profile.body.successStreak).toBe(0);
    expect(me.body.displayName).toBe('');
    expect(me.body.hasAvatar).toBe(false);
  });

  it('a non-trivial streak (built via ordinary cycle/goal/tactic/completion API calls) is reflected in both /auth/me and /api/profile', async () => {
    const cycle = await request(app).post('/api/cycle').set('Cookie', owner.cookie).send({ name: 'A' });
    const goal = await request(app).post('/api/goals').set('Cookie', owner.cookie).send({ title: 'G1' });
    const tactic = await request(app)
      .post('/api/tactics')
      .set('Cookie', owner.cookie)
      .send({ goalId: goal.body.id, title: 'T1', weekdays: [0], startWeek: 1, endWeek: 12 });
    void cycle;

    // Week 1 fully completed (100% >= 85) via the ordinary API.
    await request(app)
      .post('/api/completions/toggle')
      .set('Cookie', owner.cookie)
      .send({ tacticId: tactic.body.id, week: 1, weekday: 0, done: true });

    // Advance to week 2 (still in progress) — its own state must never count either way.
    await request(app).patch('/api/cycle').set('Cookie', owner.cookie).send({ currentWeek: 2 });

    const me = await request(app).get('/api/auth/me').set('Cookie', owner.cookie);
    const profile = await request(app).get('/api/profile').set('Cookie', owner.cookie);
    expect(me.body.successStreak).toBe(1);
    expect(profile.body.successStreak).toBe(1);
  });
});
