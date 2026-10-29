import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';
import { bearer, buildApp, SERVICE_KEY, type TestApp } from '../support/http.js';
import { createWorld, type World } from '../support/world.js';

const realConfig = JSON.parse(
  readFileSync(join(REAL_DATA_DIR, 'case_02_rules_config_V1.0.json'), 'utf8'),
) as Record<string, unknown>;

describeDb('compliance reference data and simulated services', () => {
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

  const checker = () => t.login(world.users.checkerA.email);
  const sanction = {
    list_id: 'SAN9001',
    name: 'Test Person',
    nationality: 'XA',
    program: 'FICTIONAL-FRAUD-RING',
  };

  describe('rule configuration (Compliance Officer only)', () => {
    it('reads the active configuration', async () => {
      const res = await request(t.app)
        .get('/api/v1/admin/rule-config')
        .set(bearer(await checker()));
      expect(res.status).toBe(200);
      expect(res.body.config.name_match_threshold).toBe(0.9);
    });

    it('publishes a new version, keeps the old one, and audits before/after', async () => {
      const res = await request(t.app)
        .put('/api/v1/admin/rule-config')
        .set(bearer(await checker()))
        .send({ ...realConfig, version: '1.1', name_match_threshold: 0.85 });
      expect(res.status).toBe(201);
      expect(await prisma.ruleConfig.count()).toBe(2);
      expect(await prisma.ruleConfig.count({ where: { is_active: true } })).toBe(1);
      const active = await prisma.ruleConfig.findFirstOrThrow({ where: { is_active: true } });
      expect((active.config as { name_match_threshold: number }).name_match_threshold).toBe(0.85);
      const audit = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'CONFIG_CHANGED' },
      });
      expect(audit).toMatchObject({
        actor_user_id: world.users.checkerA.id,
        before: { version: '1.0' },
        after: { version: '1.1' },
      });
    });

    it('rejects an incomplete configuration with the missing keys named, and a repeat with 409', async () => {
      const bad = await request(t.app)
        .put('/api/v1/admin/rule-config')
        .set(bearer(await checker()))
        .send({ version: '2.0' });
      expect(bad.status).toBe(400);
      expect((bad.body.fields as { field: string }[]).map((f) => f.field)).toContain('min_age');
      const body = { ...realConfig, version: '1.2' };
      expect(
        (
          await request(t.app)
            .put('/api/v1/admin/rule-config')
            .set(bearer(await checker()))
            .send(body)
        ).status,
      ).toBe(201);
      expect(
        (
          await request(t.app)
            .put('/api/v1/admin/rule-config')
            .set(bearer(await checker()))
            .send(body)
        ).status,
      ).toBe(409);
    });

    it('is forbidden to a KYC officer (403)', async () => {
      const res = await request(t.app)
        .put('/api/v1/admin/rule-config')
        .set(bearer(await t.login(world.users.officerA.email)))
        .send(realConfig);
      expect(res.status).toBe(403);
    });
  });

  describe('watchlists (Compliance Officer only)', () => {
    it('adds, lists and removes a sanctions entry, with an audit row for each change', async () => {
      const token = await checker();
      expect(
        (
          await request(t.app)
            .post('/api/v1/admin/watchlists/sanctions')
            .set(bearer(token))
            .send(sanction)
        ).status,
      ).toBe(201);
      const list = await request(t.app)
        .get('/api/v1/admin/watchlists/sanctions')
        .set(bearer(token));
      expect(list.body.entries).toEqual([
        expect.objectContaining({ list_id: 'SAN9001', alias: null, dob: null }),
      ]);
      expect(
        (
          await request(t.app)
            .delete('/api/v1/admin/watchlists/sanctions/SAN9001')
            .set(bearer(token))
        ).status,
      ).toBe(204);
      expect(
        (
          await request(t.app)
            .delete('/api/v1/admin/watchlists/sanctions/SAN9001')
            .set(bearer(token))
        ).status,
      ).toBe(404);
      const actions = (
        await prisma.auditEvent.findMany({
          where: { event_type: 'CONFIG_CHANGED' },
          orderBy: { id: 'asc' },
        })
      ).map((e) => (e.details as { action: string }).action);
      expect(actions).toEqual(['ADD', 'REMOVE']);
    });

    it('validates entries like the importer does and refuses duplicates', async () => {
      const token = await checker();
      const badDate = await request(t.app)
        .post('/api/v1/admin/watchlists/sanctions')
        .set(bearer(token))
        .send({ ...sanction, dob: '1986-02-30' });
      expect(badDate.status).toBe(400);
      expect((badDate.body.fields as { field: string }[])[0]?.field).toBe('dob');
      await request(t.app)
        .post('/api/v1/admin/watchlists/sanctions')
        .set(bearer(token))
        .send(sanction);
      expect(
        (
          await request(t.app)
            .post('/api/v1/admin/watchlists/sanctions')
            .set(bearer(token))
            .send(sanction)
        ).status,
      ).toBe(409);
    });

    it('manages the PEP list the same way', async () => {
      const token = await checker();
      const pep = {
        pep_id: 'PEP9001',
        name: 'Test Official',
        dob: '1970-01-01',
        position: 'Mayor (fictional)',
        category: 'DOMESTIC',
      };
      expect(
        (await request(t.app).post('/api/v1/admin/watchlists/pep').set(bearer(token)).send(pep))
          .status,
      ).toBe(201);
      expect(
        (
          await request(t.app)
            .post('/api/v1/admin/watchlists/pep')
            .set(bearer(token))
            .send({ ...pep, pep_id: 'PEP9002', category: 'OTHER' })
        ).status,
      ).toBe(400);
      expect(
        (await request(t.app).delete('/api/v1/admin/watchlists/pep/PEP9001').set(bearer(token)))
          .status,
      ).toBe(204);
    });

    it('is forbidden to applicants and KYC officers (403)', async () => {
      for (const email of [world.users.applicantA.email, world.users.officerA.email]) {
        const res = await request(t.app)
          .post('/api/v1/admin/watchlists/sanctions')
          .set(bearer(await t.login(email)))
          .send(sanction);
        expect(res.status).toBe(403);
      }
      expect(await prisma.sanctionsEntry.count()).toBe(0);
    });
  });

  describe('simulated core-banking service', () => {
    const open = (app: string, key?: string) => {
      const req = request(t.app).post('/internal/core-banking/accounts');
      return (key ? req.set('x-service-key', key) : req).send({ application_id: app });
    };

    it('needs the service key: none, wrong, or a user token are all 401', async () => {
      expect((await open('T000001')).status).toBe(401);
      expect((await open('T000001', 'wrong-key')).status).toBe(401);
      const asUser = await request(t.app)
        .post('/internal/core-banking/accounts')
        .set(bearer(await checker()))
        .send({ application_id: 'T000001' });
      expect(asUser.status).toBe(401);
      expect(await prisma.coreBankingAccount.count()).toBe(0);
    });

    it('with the key: refuses cases that are not approved, opens an account for approved ones, and is idempotent', async () => {
      expect((await open('T000001', SERVICE_KEY)).status).toBe(409);
      expect((await open('T999999', SERVICE_KEY)).status).toBe(404);
      await prisma.application.update({
        where: { application_id: 'T000001' },
        data: { status: 'AUTO_APPROVED' },
      });
      const first = await open('T000001', SERVICE_KEY);
      expect(first.status).toBe(201);
      const again = await open('T000001', SERVICE_KEY);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await prisma.coreBankingAccount.count()).toBe(1);
    });

    it('is not reachable under the public /api prefix', async () => {
      const res = await request(t.app)
        .post('/api/v1/internal/core-banking/accounts')
        .set('x-service-key', SERVICE_KEY)
        .send({ application_id: 'T000001' });
      expect(res.status).toBe(404);
    });
  });
});
