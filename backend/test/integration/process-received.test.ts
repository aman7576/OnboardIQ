// Imported applications arrive as SUBMITTED. Processing them runs the same pipeline as a submission, and with the
// mock provider the decisions must equal the expected columns of the sample file.
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { loadRealWorld, type Who } from '../support/real-data.js';
import { PASSWORD } from '../support/world.js';

describeDb('processing received applications (real data)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  let users: Awaited<ReturnType<typeof loadRealWorld>>;
  let received = 0; // the shared fixtures move two sample cases to IN_REVIEW, so 158 of 160 arrive SUBMITTED
  beforeAll(async () => {
    prisma = testPrisma();
    await truncateAll(prisma);
    users = await loadRealWorld(prisma);
    received = await prisma.application.count({ where: { status: 'SUBMITTED' } });
    t = buildApp(prisma);
  }, 60_000);
  afterAll(() => prisma.$disconnect());
  const post = async (who: Who) =>
    request(t.app)
      .post('/api/v1/admin/process-received')
      .set(bearer(await t.login(users[who].email, PASSWORD)));

  it('is for Compliance Officers only', async () => {
    expect((await post('officerA')).status).toBe(403);
    expect((await post('applicantA')).status).toBe(403);
    expect(received).toBeGreaterThan(150);
    expect(await prisma.application.count({ where: { status: 'SUBMITTED' } })).toBe(received);
  });

  it('routes every received application, and the sample decisions equal the expected columns', async () => {
    const res = await post('checkerA');
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(received);
    const total = Object.values(res.body.by_status as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(received);
    expect(await prisma.application.count({ where: { status: 'SUBMITTED' } })).toBe(0);

    const expected = await prisma.applicationExpected.findMany();
    expect(expected).toHaveLength(60);
    let compared = 0;
    for (const e of expected) {
      const ev = await prisma.ruleEvaluation.findFirst({
        where: { application_id: e.application_id },
      });
      if (!ev) continue; // one of the two fixture cases, not processed here
      compared++;
      expect({ id: e.application_id, d: ev.decision, c: ev.reason_codes.join('|') }).toEqual({
        id: e.application_id,
        d: e.expected_decision,
        c: e.expected_reason_codes,
      });
    }
    expect(compared).toBeGreaterThanOrEqual(58);
    // every case is routed as spec 6.1.2 and audited
    const accounts = await prisma.coreBankingAccount.count();
    expect(accounts).toBe(res.body.by_status.AUTO_APPROVED);
  });

  it('is safe to repeat and leaves an application started on screen with its applicant', async () => {
    const token = await t.login(users.applicantA.email, PASSWORD);
    const created = await request(t.app).post('/api/v1/applications').set(bearer(token)).send({
      full_name: 'Neha Kapoor',
      dob: '1992-03-14',
      gender: 'F',
      pan_number: 'ABCPK4321D',
      aadhaar_last4: '4321',
      mobile: '9812345678',
      email: 'neha@example.com',
      address: '12 Park Street',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700016',
      occupation_code: 'SALARIED_PRIVATE',
      annual_income: 800000,
      consent_kyc: true,
    });
    expect(created.status).toBe(201);
    const again = await post('checkerA');
    expect(again.body).toEqual({ processed: 0, by_status: {}, skipped: [] });
    const live = await prisma.application.findUniqueOrThrow({
      where: { application_id: created.body.application_id },
    });
    expect(live.status).toBe('SUBMITTED');
  });
});
