import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import {
  bearer,
  buildApp,
  SESSION_SECRET,
  SESSION_TTL_MINUTES,
  type TestApp,
} from '../support/http.js';
import { createWorld, PASSWORD, type World } from '../support/world.js';
import { hashSessionToken } from '../../src/modules/auth/session-token.js';

describeDb('authentication', () => {
  let prisma: PrismaClient;
  let world: World;
  let t: TestApp;

  beforeAll(() => {
    prisma = testPrisma();
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await truncateAll(prisma);
    world = await createWorld(prisma);
    t = buildApp(prisma);
  });

  const auditTypes = async () =>
    (await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => e.event_type);

  describe('unauthenticated requests get 401', () => {
    const endpoints: [string, string][] = [
      ['get', '/api/v1/auth/me'],
      ['post', '/api/v1/auth/logout'],
      ['get', '/api/v1/applications/mine'],
      ['get', '/api/v1/applications/T000001'],
      ['get', '/api/v1/applications/T000001/documents'],
      ['get', '/api/v1/applications/T000001/documents/DT000001'],
      ['get', '/api/v1/review/queue'],
      ['post', '/api/v1/applications/T000001/recommendation'],
      ['post', '/api/v1/applications/T000004/checker-decision'],
      ['get', '/api/v1/admin/rule-config'],
      ['get', '/api/v1/admin/audit/T000001'],
    ];
    it.each(endpoints)('%s %s', async (method, path) => {
      const res = await request(t.app)[method as 'get' | 'post'](path);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    });

    it.each(['Bearer', 'Bearer not-a-real-token', 'Basic dXNlcjpwYXNz', 'oiq_abc'])(
      'rejects Authorization "%s"',
      async (value) => {
        const res = await request(t.app).get('/api/v1/auth/me').set('Authorization', value);
        expect(res.status).toBe(401);
      },
    );
  });

  describe('login', () => {
    it('returns a short-lived bearer token and the public user', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.officerA.email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        token_type: 'Bearer',
        user: { email: 'officer-a@test.local', role: 'KYC_OFFICER' },
      });
      expect(res.body.token).toMatch(/^oiq_/);
      const ttl = new Date(res.body.expires_at as string).getTime() - t.clock.now.getTime();
      expect(ttl).toBe(SESSION_TTL_MINUTES * 60_000);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('never returns the password hash and is case-insensitive on e-mail', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: 'OFFICER-A@Test.Local', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/i);
    });

    it('stores only a keyed hash of the token, never the token', async () => {
      const token = await t.login(world.users.applicantA.email);
      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.token_hash).toBe(hashSessionToken(token, SESSION_SECRET));
      expect(sessions[0]?.token_hash).not.toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(sessions)).not.toContain(token);
    });

    it('/auth/me works with the token', async () => {
      const token = await t.login(world.users.checkerA.email);
      const res = await request(t.app).get('/api/v1/auth/me').set(bearer(token));
      expect(res.body.user).toEqual({
        id: world.users.checkerA.id,
        email: 'checker-a@test.local',
        display_name: 'checker-a',
        role: 'COMPLIANCE_OFFICER',
      });
    });
  });

  describe('incorrect credentials get 401 with one generic message', () => {
    it('wrong password', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.officerA.email, password: 'Wrong-Password-1' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid e-mail or password',
      });
    });

    it('unknown e-mail gives the identical response (no user enumeration)', async () => {
      const wrong = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.officerA.email, password: 'Wrong-Password-1' });
      const unknown = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.local', password: 'Wrong-Password-1' });
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.body).toEqual(wrong.body);
    });

    it('disabled account cannot log in, even with the right password', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.disabled.email, password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it('missing or unexpected fields get 400 naming the field', async () => {
      const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'a@b.c' });
      expect(res.status).toBe(400);
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'password' })]);
    });

    it('locks after five failures with 429, even for the right password', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(t.app)
          .post('/api/v1/auth/login')
          .send({ email: world.users.applicantA.email, password: 'Wrong-Password-1' });
        expect(res.status).toBe(401);
      }
      const locked = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.applicantA.email, password: PASSWORD });
      expect(locked.status).toBe(429);
      t.clock.now = new Date(t.clock.now.getTime() + 15 * 60_000 + 1000);
      const later = await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.applicantA.email, password: PASSWORD });
      expect(later.status).toBe(200);
    });

    it('audits failed logins without recording the password', async () => {
      await request(t.app)
        .post('/api/v1/auth/login')
        .send({ email: world.users.officerA.email, password: 'Wrong-Password-1' });
      const events = await prisma.auditEvent.findMany({ where: { event_type: 'LOGIN_FAILED' } });
      expect(events).toHaveLength(1);
      expect(events[0]?.details).toEqual({ email: 'officer-a@test.local' });
      expect(
        JSON.stringify(events, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
      ).not.toContain('Wrong-Password-1');
    });
  });

  describe('sessions', () => {
    it('logout revokes the token (204, then 401) and is audited', async () => {
      const token = await t.login(world.users.applicantA.email);
      expect((await request(t.app).post('/api/v1/auth/logout').set(bearer(token))).status).toBe(
        204,
      );
      expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
      expect(await auditTypes()).toEqual(['LOGIN_SUCCEEDED', 'LOGOUT']);
    });

    it('expires after the configured lifetime', async () => {
      const token = await t.login(world.users.applicantA.email);
      t.clock.now = new Date(t.clock.now.getTime() + (SESSION_TTL_MINUTES * 60_000 - 1000));
      expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(200);
      t.clock.now = new Date(t.clock.now.getTime() + 2000);
      expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
    });

    it('stops working at once when the account is disabled', async () => {
      const token = await t.login(world.users.officerA.email);
      await prisma.user.update({
        where: { id: world.users.officerA.id },
        data: { is_active: false },
      });
      expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
    });

    it('rejects a token signed with a different secret', async () => {
      const token = await t.login(world.users.officerA.email);
      await prisma.session.updateMany({
        data: { token_hash: hashSessionToken(token, 'another-secret-'.repeat(3)) },
      });
      expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
    });
  });

  describe('registration', () => {
    const body = {
      email: 'New.Person@Example.com',
      password: 'Long-Enough-Pass-1',
      display_name: 'New Person',
    };

    it('creates an applicant, hashes the password, and can then log in', async () => {
      const res = await request(t.app).post('/api/v1/auth/register').send(body);
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email: 'new.person@example.com', role: 'APPLICANT' });
      const stored = await prisma.user.findUniqueOrThrow({
        where: { email: 'new.person@example.com' },
      });
      expect(stored.password_hash).toMatch(/^scrypt\$/);
      expect(stored.password_hash).not.toContain(body.password);
      await t.login('new.person@example.com', body.password);
      expect(await auditTypes()).toContain('USER_REGISTERED');
    });

    it('refuses to let a caller choose a role (strict body)', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/register')
        .send({ ...body, role: 'COMPLIANCE_OFFICER' });
      expect(res.status).toBe(400);
      expect(await prisma.user.count({ where: { email: 'new.person@example.com' } })).toBe(0);
    });

    it('rejects weak passwords and bad e-mails with field names', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short', display_name: 'X' });
      expect(res.status).toBe(400);
      expect((res.body.fields as { field: string }[]).map((f) => f.field).sort()).toEqual([
        'display_name',
        'email',
        'password',
      ]);
    });

    it('returns 409 for an e-mail that is already registered', async () => {
      const res = await request(t.app)
        .post('/api/v1/auth/register')
        .send({ ...body, email: world.users.applicantA.email });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('EMAIL_TAKEN');
    });
  });

  it('answers malformed JSON with 400 and no stack trace', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js)/);
  });

  it('never writes passwords or tokens to the request log', async () => {
    const token = await t.login(world.users.officerA.email);
    await request(t.app)
      .post('/api/v1/auth/login')
      .send({ email: 'x@y.z', password: 'Wrong-Password-1' });
    await request(t.app).get('/api/v1/auth/me').set(bearer(token));
    const log = t.logs.join('\n');
    expect(t.logs.length).toBeGreaterThanOrEqual(3);
    for (const secret of [PASSWORD, 'Wrong-Password-1', token]) expect(log).not.toContain(secret);
  });
});
