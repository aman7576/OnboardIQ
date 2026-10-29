// The endpoints the screens depend on: applicant reasons and timeline, risk-ordered queues, the dashboard
// aggregates, the audit viewer and the AI evaluation results. Real supplied data; figures are recomputed
// independently from the database rows.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateOutputs } from '../../src/outputs/generate.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { loadRealWorld, type Who } from '../support/real-data.js';
import { PASSWORD } from '../support/world.js';

describeDb('screen endpoints (real data)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  let users: Awaited<ReturnType<typeof loadRealWorld>>;
  const outputDir = mkdtempSync(join(tmpdir(), 'onboardiq-ui-output-'));
  const tokens = new Map<Who, string>();

  beforeAll(async () => {
    prisma = testPrisma();
    await truncateAll(prisma);
    users = await loadRealWorld(prisma);
    t = buildApp(prisma, { outputDir });
    // Drive real cases through the real workflow: auto-approved, auto-rejected, review (x2), high-risk approval.
    for (const [id, owner] of [
      ['A2000001', 'applicantA'],
      ['A2000002', 'applicantB'],
      ['A2000004', 'applicantA'],
      ['A2000009', 'applicantB'],
      ['A2000010', 'applicantA'],
    ] as const) {
      await prisma.application.update({
        where: { application_id: id },
        data: { applicant_user_id: users[owner].id },
      });
      const res = await call('post', `/applications/${id}/submit`, owner);
      expect(res.status).toBe(200);
    }
  }, 60_000);
  afterAll(() => prisma.$disconnect());

  const token = async (who: Who) => {
    if (!tokens.has(who)) tokens.set(who, await t.login(users[who].email, PASSWORD));
    return tokens.get(who) as string;
  };
  const call = async (method: 'get' | 'post', path: string, who: Who, body?: object) => {
    const req = request(t.app)
      [method](`/api/v1${path}`)
      .set(bearer(await token(who)));
    return body === undefined ? req : req.send(body);
  };

  describe('applicant view', () => {
    it('gives plain-language reasons and a status timeline, and never codes, scores or watchlist data', async () => {
      const res = await call('get', '/applications/A2000004', 'applicantA'); // IN_REVIEW: minor name mismatch
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('IN_REVIEW');
      expect(res.body.reasons).toEqual([
        'The name on your documents differs slightly from the name you entered, so an officer will check it.',
      ]);
      expect(res.body.timeline.map((e: { status: string }) => e.status)).toEqual([
        'SUBMITTED',
        'EXTRACTING',
        'IN_REVIEW',
      ]);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(
        /NAME_MISMATCH|confidence|screening|similarity|SAN\d|PEP\d|actor_role/,
      );
    });

    it('shows no reasons for an approved case', async () => {
      const res = await call('get', '/applications/A2000001', 'applicantA');
      expect(res.body).toMatchObject({ status: 'AUTO_APPROVED', reasons: [] });
    });
  });

  describe('officer case view', () => {
    it('carries the confidence limit from the configuration, the rule trace and only the latest extraction', async () => {
      const res = await call('get', '/applications/A2000009', 'officerA');
      expect(res.body.thresholds).toEqual({ min_field_confidence: 0.8 });
      expect(res.body.timeline[0]).toMatchObject({ status: 'SUBMITTED' });
      expect(res.body.timeline.at(-1)).toMatchObject({
        status: 'IN_REVIEW',
        actor_role: 'APPLICANT',
      });
      expect(res.body.evaluation.trace).toHaveLength(17);
      const pan = res.body.documents
        .flatMap(
          (d: { extracted_fields: { field_name: string; confidence: number; source: string }[] }) =>
            d.extracted_fields,
        )
        .find((f: { field_name: string }) => f.field_name === 'pan_number');
      expect(pan).toMatchObject({ confidence: 0.62, source: 'EXTRACTOR' });
    });
  });

  describe('review queues (FR-6)', () => {
    it('list risk and decision per case, with HIGH risk first, then the longest waiting', async () => {
      await prisma.application.update({
        where: { application_id: 'A2000003' },
        data: { status: 'IN_REVIEW' },
      });
      const res = await call('get', '/review/queue', 'officerA');
      expect(res.body.queue).toBe('IN_REVIEW');
      const items = res.body.applications as {
        application_id: string;
        risk_category: string | null;
        decision: string | null;
        reason_codes: string[];
        waiting_since: string;
        pan_masked: string;
      }[];
      const ids = items.map((i) => i.application_id);
      expect(ids).toEqual(expect.arrayContaining(['A2000004', 'A2000009']));
      expect(items.find((i) => i.application_id === 'A2000004')).toMatchObject({
        decision: 'REVIEW',
        risk_category: 'LOW',
        reason_codes: ['NAME_MISMATCH_MINOR'],
      });
      const order = items.map((i) =>
        ['HIGH', 'MEDIUM', 'LOW'].indexOf(i.risk_category ?? '') === -1
          ? 9
          : ['HIGH', 'MEDIUM', 'LOW'].indexOf(i.risk_category ?? ''),
      );
      expect([...order].sort((a, b) => a - b)).toEqual(order); // risk never goes back up the list
      const unevaluated = items.map((i) => i.decision === null);
      expect([...unevaluated].sort((a, b) => Number(a) - Number(b))).toEqual(unevaluated); // cases without an evaluation come last
      expect(items.find((i) => i.application_id === 'A2000003')?.risk_category).toBeNull();
      for (const i of items) expect(i.pan_masked).toMatch(/^ZZ[A-Z]X{5}\d[A-Z]$/);
      await prisma.application.update({
        where: { application_id: 'A2000003' },
        data: { status: 'SUBMITTED' },
      });
    });

    it('the checker queue lists the HIGH-risk approval', async () => {
      const res = await call('get', '/review/queue', 'checkerA');
      expect(res.body.queue).toBe('PENDING_CHECKER');
      expect(res.body.applications[0]).toMatchObject({
        application_id: 'A2000010',
        risk_category: 'HIGH',
        decision: 'APPROVE',
      });
    });
  });

  describe('compliance dashboard (FR-10)', () => {
    it('reconciles with the underlying data', async () => {
      const res = await call('get', '/admin/dashboard', 'checkerA');
      expect(res.status).toBe(200);
      const d = res.body;

      // independent recomputation straight from the tables
      const grouped = await prisma.application.groupBy({ by: ['status'], _count: { _all: true } });
      for (const g of grouped) expect(d.by_status[g.status]).toBe(g._count._all);
      expect(Object.values(d.by_status as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
        d.total_applications,
      );
      expect(d.total_applications).toBe(await prisma.application.count());

      const evals = await prisma.ruleEvaluation.findMany({ orderBy: { created_at: 'asc' } });
      const firstByApp = new Map<string, (typeof evals)[number]>();
      for (const e of evals)
        if (!firstByApp.has(e.application_id)) firstByApp.set(e.application_id, e);
      const firsts = [...firstByApp.values()];
      expect(d.decided.count).toBe(5);
      expect(d.decided).toMatchObject({
        approve: firsts.filter((e) => e.decision === 'APPROVE').length,
        review: firsts.filter((e) => e.decision === 'REVIEW').length,
        reject: firsts.filter((e) => e.decision === 'REJECT').length,
      });
      expect(d.decided).toEqual({ count: 5, approve: 2, review: 2, reject: 1 }); // examples 1, 10 / 4, 9 / 2
      expect(d.rates.straight_through).toBeCloseTo(d.by_status.AUTO_APPROVED / 5, 12);
      expect(d.rates.review).toBeCloseTo(2 / 5, 12);
      expect(d.rates.reject).toBeCloseTo(1 / 5, 12);

      const counts = new Map<string, number>();
      for (const e of firsts)
        for (const c of e.reason_codes) counts.set(c, (counts.get(c) ?? 0) + 1);
      const expectedTop = [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([code, count]) => ({ code, count }));
      expect(d.top_reason_codes).toEqual(expectedTop);
      expect(d.top_reason_codes.length).toBeLessThanOrEqual(5);

      expect(d.pending_checker).toMatchObject({
        count: await prisma.application.count({ where: { status: 'PENDING_CHECKER' } }),
        sla_hours: 24,
      });
      expect(d.review_time).toMatchObject({
        average_seconds: null,
        completed_reviews: 0,
        open_reviews: 2,
      }); // nobody has left review yet
      expect(Object.keys(d.definitions)).toContain('straight_through_rate');
    });

    it('measures time in review and overdue checker items from the audit trail', async () => {
      expect(
        (
          await call('post', '/applications/A2000004/recommendation', 'officerA', {
            recommendation: 'APPROVE',
            comment: 'Name is the same person.',
          })
        ).status,
      ).toBe(201);
      const d = (await call('get', '/admin/dashboard', 'checkerA')).body;
      expect(d.review_time.completed_reviews).toBe(1);
      const events = await prisma.auditEvent.findMany({
        where: { application_id: 'A2000004', event_type: 'STATUS_CHANGED' },
        orderBy: { id: 'asc' },
      });
      const entered =
        events
          .find((e) => (e.after as { status: string }).status === 'IN_REVIEW')
          ?.created_at.getTime() ?? 0;
      const left =
        events
          .find((e) => (e.before as { status?: string }).status === 'IN_REVIEW')
          ?.created_at.getTime() ?? 0;
      expect(d.review_time.average_seconds).toBeCloseTo((left - entered) / 1000, 3);
      expect(d.pending_checker.overdue).toBe(0);
      t.clock.now = new Date(t.clock.now.getTime() + 25 * 3_600_000);
      tokens.clear();
      try {
        expect(
          (await call('get', '/admin/dashboard', 'checkerA')).body.pending_checker,
        ).toMatchObject({ count: 2, overdue: 2 });
      } finally {
        t.clock.now = new Date(t.clock.now.getTime() - 25 * 3_600_000);
        tokens.clear();
      }
    });

    it('filters by application date and validates the range', async () => {
      expect(
        (await call('get', '/admin/dashboard?from=2026-03-04&to=2026-03-04', 'checkerA')).body
          .total_applications,
      ).toBe(60);
      expect(
        (await call('get', '/admin/dashboard?from=2026-03-05&to=2026-03-05', 'checkerA')).body
          .total_applications,
      ).toBe(100);
      const none = (await call('get', '/admin/dashboard?from=2030-01-01', 'checkerA')).body;
      expect(none).toMatchObject({
        total_applications: 0,
        decided: { count: 0 },
        rates: { straight_through: null, review: null, reject: null },
        top_reason_codes: [],
      });
      const bad = await call('get', '/admin/dashboard?from=yesterday', 'checkerA');
      expect(bad.status).toBe(400);
      expect(bad.body.fields[0].field).toBe('from');
    });

    it('is for Compliance Officers only', async () => {
      for (const who of ['applicantA', 'officerA'] as const)
        expect((await call('get', '/admin/dashboard', who)).status).toBe(403);
      expect((await request(t.app).get('/api/v1/admin/dashboard')).status).toBe(401);
    });
  });

  describe('reference data', () => {
    it('lists the occupations from the database for the application form, to any signed-in user', async () => {
      const res = await call('get', '/reference/occupations', 'applicantA');
      expect(res.status).toBe(200);
      expect(res.body.occupations).toHaveLength(12);
      expect(res.body.occupations).toContainEqual({
        code: 'SALARIED_PRIVATE',
        description: 'Salaried - private sector',
      });
      expect((await request(t.app).get('/api/v1/reference/occupations')).status).toBe(401);
    });
  });

  describe('audit viewer', () => {
    it('returns the history with actor names, and exports it as CSV', async () => {
      const res = await call('get', '/admin/audit/A2000004', 'checkerA');
      expect(res.status).toBe(200);
      const events = res.body.events as {
        type: string;
        actor_name: string | null;
        actor_role: string;
      }[];
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining(['STATUS_CHANGED', 'DECISION_RECORDED', 'RECOMMENDATION_RECORDED']),
      );
      expect(events.find((e) => e.type === 'RECOMMENDATION_RECORDED')).toMatchObject({
        actor_name: 'officerA',
        actor_role: 'KYC_OFFICER',
      });
      expect(
        events.find((e) => e.actor_role === 'SYSTEM' || e.actor_role === 'APPLICANT'),
      ).toBeDefined();

      const csv = await call('get', '/admin/audit/A2000004?format=csv', 'checkerA');
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.headers['content-disposition']).toContain('audit_A2000004.csv');
      const lines = csv.text.trimEnd().split('\n');
      expect(lines[0]).toBe('id,at,type,actor_role,actor_name,doc_id,before,after,details');
      expect(lines.length).toBeGreaterThan(events.length); // JSON cells with commas are quoted, so rows may wrap only by quoting
      expect(csv.text).toContain('"{""status"":""IN_REVIEW""}"');
    });

    it('is not available to applicants or officers', async () => {
      for (const who of ['applicantA', 'officerA'] as const)
        expect((await call('get', '/admin/audit/A2000004', who)).status).toBe(403);
    });
  });

  describe('AI evaluation results', () => {
    it('answers 404 with a hint while nothing has been generated', async () => {
      const res = await call('get', '/admin/ai-evaluation', 'checkerA');
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/npm run outputs/);
    });

    it('serves the generated report, model card and metrics exactly as written to disk', async () => {
      await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir });
      const res = await call('get', '/admin/ai-evaluation', 'checkerA');
      expect(res.status).toBe(200);
      expect(res.body.report_markdown).toBe(
        readFileSync(join(outputDir, 'evaluation_report.md'), 'utf8'),
      );
      expect(res.body.model_card_markdown).toBe(
        readFileSync(join(outputDir, 'model_card.md'), 'utf8'),
      );
      expect(res.body.metrics.sample.ai.metrics.classification.overall).toMatchObject({
        total: 178,
      });
      expect(res.body.files.map((f: { name: string }) => f.name)).toEqual([
        'evaluation_metrics.json',
        'evaluation_report.md',
        'model_card.md',
      ]);
      for (const f of res.body.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await call('get', '/admin/ai-evaluation', 'officerA')).status).toBe(403);
    }, 60_000);
  });
});
