import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { createWorld, type World } from '../support/world.js';

describeDb('maker-checker workflow', () => {
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

  const as = (key: keyof World['users']) => t.login(world.users[key].email);
  const recommend = async (id: string, key: keyof World['users'], body: object) =>
    request(t.app)
      .post(`/api/v1/applications/${id}/recommendation`)
      .set(bearer(await as(key)))
      .send(body);
  const decide = async (id: string, key: keyof World['users'], body: object) =>
    request(t.app)
      .post(`/api/v1/applications/${id}/checker-decision`)
      .set(bearer(await as(key)))
      .send(body);
  const status = async (id: string) =>
    (await prisma.application.findUniqueOrThrow({ where: { application_id: id } })).status;
  const OK_REC = { recommendation: 'APPROVE', comment: 'Documents match the declaration.' };

  describe('officer recommendation (maker)', () => {
    it('records the recommendation, moves IN_REVIEW to PENDING_CHECKER and audits it', async () => {
      const res = await recommend(world.apps.review, 'officerA', OK_REC);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ application_id: 'T000001', status: 'PENDING_CHECKER' });
      const row = await prisma.application.findUniqueOrThrow({
        where: { application_id: 'T000001' },
      });
      expect(row.version).toBe(1);
      const events = await prisma.auditEvent.findMany({
        where: { application_id: 'T000001' },
        orderBy: { id: 'asc' },
      });
      expect(events.map((e) => e.event_type)).toEqual([
        'RECOMMENDATION_RECORDED',
        'STATUS_CHANGED',
      ]);
      expect(events[1]).toMatchObject({
        before: { status: 'IN_REVIEW' },
        after: { status: 'PENDING_CHECKER' },
        actor_user_id: world.users.officerA.id,
      });
    });

    it('REQUEST_RESUBMISSION moves the case to RESUBMISSION_REQUESTED', async () => {
      const res = await recommend(world.apps.review, 'officerA', {
        recommendation: 'REQUEST_RESUBMISSION',
        comment: 'Please upload a recent bill.',
      });
      expect(res.status).toBe(201);
      expect(await status('T000001')).toBe('RESUBMISSION_REQUESTED');
    });

    it('needs a comment of at least 10 characters (400 naming the field)', async () => {
      const res = await recommend(world.apps.review, 'officerA', {
        recommendation: 'APPROVE',
        comment: 'too short',
      });
      expect(res.status).toBe(400);
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'comment' })]);
      expect(await status('T000001')).toBe('IN_REVIEW');
    });

    it('rejects an unknown recommendation value', async () => {
      expect(
        (
          await recommend(world.apps.review, 'officerA', {
            recommendation: 'MAYBE',
            comment: 'Long enough comment.',
          })
        ).status,
      ).toBe(400);
    });

    it('is refused with 409 when the case is not IN_REVIEW', async () => {
      const res = await recommend(world.apps.pending, 'officerA', OK_REC);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INVALID_STATE');
    });
  });

  describe('checker decision', () => {
    it('example 11: the recommending officer cannot approve (403); a different checker can (APPROVED + account)', async () => {
      expect((await recommend(world.apps.review, 'officerA', OK_REC)).status).toBe(201);

      const sameOfficer = await decide(world.apps.review, 'officerA', {
        action: 'APPROVE',
        comment: 'Approving my own case',
      });
      expect(sameOfficer.status).toBe(403);
      expect(await status('T000001')).toBe('PENDING_CHECKER');

      const res = await decide(world.apps.review, 'checkerB', {
        action: 'APPROVE',
        comment: 'Verified independently.',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ application_id: 'T000001', status: 'APPROVED' });
      expect(res.body.account.customer_id).toMatch(/^KB\d{6}$/);
      expect(res.body.account.account_number).toMatch(/^\d{12}$/);
      expect(await prisma.coreBankingAccount.count()).toBe(1);
      const types = (
        await prisma.auditEvent.findMany({
          where: { application_id: 'T000001' },
          orderBy: { id: 'asc' },
        })
      ).map((e) => e.event_type);
      expect(types).toEqual([
        'RECOMMENDATION_RECORDED',
        'STATUS_CHANGED',
        'STATUS_CHANGED',
        'CHECKER_DECISION_RECORDED',
        'ACCOUNT_OPENED',
      ]);
      // The refused role attempt is audited too (by the role gate, so not tied to one application).
      const denied = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'ACCESS_DENIED' },
      });
      expect(denied).toMatchObject({
        actor_user_id: world.users.officerA.id,
        actor_role: 'KYC_OFFICER',
      });
      expect(denied.details).toMatchObject({ reason: 'ROLE' });
    });

    it('maker and checker must be different users (403), even when the same person holds the checker role', async () => {
      // checkerA is recorded as the maker of the pending case (for example, promoted after recommending).
      await prisma.officerRecommendation.updateMany({
        where: { application_id: 'T000004' },
        data: { officer_id: world.users.checkerA.id },
      });
      const same = await decide(world.apps.pending, 'checkerA', {
        action: 'APPROVE',
        comment: 'Self-approval attempt',
      });
      expect(same.status).toBe(403);
      expect(same.body.error).toBe('MAKER_CHECKER_SAME_USER');
      expect(await status('T000004')).toBe('PENDING_CHECKER');
      expect(await prisma.checkerDecision.count()).toBe(0);
      expect(await prisma.coreBankingAccount.count()).toBe(0);
      const denial = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'ACCESS_DENIED', application_id: 'T000004' },
      });
      expect(denial.details).toMatchObject({ reason: 'MAKER_CHECKER_SAME_USER' });

      expect(
        (
          await decide(world.apps.pending, 'checkerB', {
            action: 'APPROVE',
            comment: 'Independent check done',
          })
        ).status,
      ).toBe(200);
    });

    it('REJECT ends in REJECTED with no account; SEND_BACK returns the case to IN_REVIEW', async () => {
      const rejected = await decide(world.apps.pending, 'checkerA', {
        action: 'REJECT',
        comment: 'Name does not match.',
      });
      expect(rejected.body.status).toBe('REJECTED');
      expect(await prisma.coreBankingAccount.count()).toBe(0);

      await prisma.application.update({
        where: { application_id: 'T000002' },
        data: { status: 'PENDING_CHECKER' },
      });
      const back = await decide('T000002', 'checkerA', {
        action: 'SEND_BACK',
        comment: 'Needs another look.',
      });
      expect(back.body.status).toBe('IN_REVIEW');
    });

    it('a HIGH-risk approval with no maker (no recommendation) can be decided by any checker', async () => {
      await prisma.application.update({
        where: { application_id: 'T000002' },
        data: { status: 'PENDING_CHECKER' },
      });
      const res = await decide('T000002', 'checkerA', {
        action: 'APPROVE',
        comment: 'High-risk approval checked.',
      });
      expect(res.status).toBe(200);
      expect((await prisma.checkerDecision.findFirstOrThrow()).recommendation_id).toBeNull();
    });

    it('is refused with 409 when the case is not PENDING_CHECKER, and needs a comment', async () => {
      const wrongState = await decide(world.apps.review, 'checkerA', {
        action: 'APPROVE',
        comment: 'Early approval',
      });
      expect(wrongState.status).toBe(409);
      expect(wrongState.body.error).toBe('INVALID_STATE');
      const noComment = await decide(world.apps.pending, 'checkerA', {
        action: 'APPROVE',
        comment: '  ',
      });
      expect(noComment.status).toBe(400);
    });

    it('a final status cannot be changed again', async () => {
      await decide(world.apps.pending, 'checkerA', {
        action: 'APPROVE',
        comment: 'Approved after review.',
      });
      const again = await decide(world.apps.pending, 'checkerB', {
        action: 'REJECT',
        comment: 'Changed my mind',
      });
      expect(again.status).toBe(409);
      expect(await status('T000004')).toBe('APPROVED');
    });
  });

  describe('concurrency (optimistic locking)', () => {
    it('of two simultaneous checker actions exactly one succeeds and the other gets 409', async () => {
      const tokens = [await as('checkerA'), await as('checkerB')];
      const attempts = await Promise.all(
        tokens.map((token) =>
          request(t.app)
            .post(`/api/v1/applications/${world.apps.pending}/checker-decision`)
            .set(bearer(token))
            .send({ action: 'APPROVE', comment: 'Concurrent decision' }),
        ),
      );
      expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.checkerDecision.count()).toBe(1);
      expect(await prisma.coreBankingAccount.count()).toBe(1);
      const changes = await prisma.auditEvent.count({
        where: { application_id: 'T000004', event_type: 'STATUS_CHANGED' },
      });
      expect(changes).toBe(1); // the losing request left nothing behind
      expect(
        (await prisma.application.findUniqueOrThrow({ where: { application_id: 'T000004' } }))
          .version,
      ).toBe(1);
    });
  });

  describe('audit trail endpoint', () => {
    it('gives a compliance officer the full ordered history', async () => {
      await recommend(world.apps.review, 'officerA', OK_REC);
      await decide(world.apps.review, 'checkerA', { action: 'APPROVE', comment: 'Approved.' });
      const res = await request(t.app)
        .get('/api/v1/admin/audit/T000001')
        .set(bearer(await as('checkerB')));
      expect(res.status).toBe(200);
      const events = res.body.events as { id: string; type: string; actor_role: string }[];
      expect(events.map((e) => e.type)).toEqual([
        'RECOMMENDATION_RECORDED',
        'STATUS_CHANGED',
        'STATUS_CHANGED',
        'CHECKER_DECISION_RECORDED',
        'ACCOUNT_OPENED',
      ]);
      expect(typeof events[0]?.id).toBe('string');
      expect(events.map((e) => e.actor_role)).toEqual([
        'KYC_OFFICER',
        'KYC_OFFICER',
        'COMPLIANCE_OFFICER',
        'COMPLIANCE_OFFICER',
        'COMPLIANCE_OFFICER',
      ]);
    });
  });
});
