// Full application lifecycle on the real supplied data: every path of the status lifecycle (spec 6.1.1), with
// the persisted database state checked after each transition.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockProvider } from '../../src/modules/extraction/mock-provider.js';
import type { ExtractionProvider } from '../../src/modules/extraction/provider.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { loadRealWorld, type Who } from '../support/real-data.js';
import { PASSWORD } from '../support/world.js';

const DAY = 86_400_000;
const mock = createMockProvider(REAL_DATA_DIR);
// Test provider: behaves like the mock for supplied documents, and "reads" a freshly uploaded bill that the
// mock files cannot know (the real mock returns OTHER / 0.00 for it).
const scripted: ExtractionProvider = {
  name: 'MOCK',
  async extract(input) {
    if (input.text.startsWith('FRESH-BILL'))
      return {
        docType: 'ELECTRICITY_BILL',
        docTypeConfidence: 0.96,
        fields: [
          { name: 'pincode', value: '400001', confidence: 0.95 },
          { name: 'document_date', value: '2026-02-20', confidence: 0.95 },
        ],
        extractorVersion: 'test:scripted',
      };
    return mock.extract(input);
  },
};

const sample = (
  parse(readFileSync(join(REAL_DATA_DIR, 'case_02_applications_sample_V1.0.csv'), 'utf8'), {
    columns: true,
  }) as Record<string, string>[]
).map((r) => ({
  id: r.application_id as string,
  expected: r.expected_decision as string,
}));
const used = new Set([
  'A2000001',
  'A2000002',
  'A2000004',
  'A2000005',
  'A2000007',
  'A2000008',
  'A2000009',
  'A2000010',
]);
const spare = (decision: string, n: number): string[] =>
  sample
    .filter((s) => s.expected === decision && !used.has(s.id))
    .slice(0, n)
    .map((s) => s.id);

describeDb('application lifecycle and maker-checker (real data)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  let users: Awaited<ReturnType<typeof loadRealWorld>>;

  beforeAll(async () => {
    prisma = testPrisma();
    await truncateAll(prisma);
    users = await loadRealWorld(prisma);
    t = buildApp(prisma, { extraction: scripted });
  });
  afterAll(() => prisma.$disconnect());

  const tokens = new Map<Who, string>();
  const token = async (who: Who) => {
    if (!tokens.has(who)) tokens.set(who, await t.login(users[who].email, PASSWORD));
    return tokens.get(who) as string;
  };
  const call = async (method: 'get' | 'post' | 'put', path: string, who: Who, body?: object) => {
    const req = request(t.app)
      [method](`/api/v1${path}`)
      .set(bearer(await token(who)));
    return body === undefined ? req : req.send(body);
  };
  const own = (id: string, who: Who) =>
    prisma.application.update({
      where: { application_id: id },
      data: { applicant_user_id: users[who].id },
    });
  const submit = (id: string, who: Who = 'applicantA') =>
    call('post', `/applications/${id}/submit`, who);

  /** Everything persisted about a case, for assertions after each transition. */
  async function snap(id: string) {
    const app = await prisma.application.findUniqueOrThrow({ where: { application_id: id } });
    const [evals, recs, corrections, decisions, account, audit] = await Promise.all([
      prisma.ruleEvaluation.findMany({
        where: { application_id: id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.officerRecommendation.findMany({
        where: { application_id: id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.fieldCorrection.findMany({ where: { application_id: id } }),
      prisma.checkerDecision.findMany({
        where: { application_id: id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.coreBankingAccount.findUnique({ where: { application_id: id } }),
      prisma.auditEvent.findMany({ where: { application_id: id }, orderBy: { id: 'asc' } }),
    ]);
    return {
      status: app.status,
      version: app.version,
      round: app.submission_round,
      deadline: app.resubmission_deadline,
      rekyc: app.rekyc_due_date?.toISOString().slice(0, 10) ?? null,
      evals: evals.map((e) => ({
        trigger: e.trigger,
        decision: e.decision,
        codes: e.reason_codes,
        risk: e.risk_category,
        score: e.name_match_score,
      })),
      recs: recs.map((r) => r.recommendation),
      corrections,
      decisions: decisions.map((d) => d.action),
      account,
      audit,
      statusPath: audit
        .filter((a) => a.event_type === 'STATUS_CHANGED')
        .map(
          (a) =>
            `${(a.before as { status?: string } | null)?.status ?? '-'}>${(a.after as { status: string }).status}`,
        ),
      auditTypes: audit.map((a) => a.event_type),
    };
  }

  describe('automatic outcomes (rules decide, no human needed)', () => {
    it('example 1: a clean application is auto-approved, an account is opened and the re-KYC date is tracked', async () => {
      await own('A2000001', 'applicantA');
      const before = await snap('A2000001');
      expect(before).toMatchObject({ status: 'SUBMITTED', evals: [], account: null });

      const res = await submit('A2000001');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ application_id: 'A2000001', status: 'AUTO_APPROVED' }); // applicants only learn the status

      const after = await snap('A2000001');
      expect(after.status).toBe('AUTO_APPROVED');
      expect(after.statusPath).toEqual(['SUBMITTED>EXTRACTING', 'EXTRACTING>AUTO_APPROVED']);
      expect(after.evals).toEqual([
        { trigger: 'SUBMISSION', decision: 'APPROVE', codes: [], risk: 'LOW', score: 1 },
      ]);
      expect(after.account?.customer_id).toMatch(/^KB\d{6}$/);
      expect(after.rekyc).toBe('2036-03-04');
      expect(after.version).toBe(2);
      expect(after.auditTypes).toEqual([
        'STATUS_CHANGED',
        'DECISION_RECORDED',
        'STATUS_CHANGED',
        'ACCOUNT_OPENED',
      ]);
      const stored = await prisma.ruleEvaluation.findFirstOrThrow({
        where: { application_id: 'A2000001' },
      });
      expect(stored).toMatchObject({ rules_version: '1.0.0', extraction_provider: 'MOCK' });
      expect(Array.isArray(stored.trace) && stored.trace.length).toBe(17);
    });

    it('example 2: an applicant under 18 is auto-rejected: no risk, no re-KYC date, no account', async () => {
      await own('A2000002', 'applicantB');
      const res = await submit('A2000002', 'applicantB');
      expect(res.body.status).toBe('AUTO_REJECTED');
      const s = await snap('A2000002');
      expect(s).toMatchObject({ status: 'AUTO_REJECTED', account: null, rekyc: null });
      expect(s.evals).toEqual([
        {
          trigger: 'SUBMISSION',
          decision: 'REJECT',
          codes: ['AGE_BELOW_18'],
          risk: null,
          score: 1,
        },
      ]);
      // a final status cannot be changed by any further call
      expect((await submit('A2000002', 'applicantB')).status).toBe(409);
      expect(
        (
          await call('post', '/applications/A2000002/checker-decision', 'checkerA', {
            action: 'APPROVE',
            comment: 'override attempt',
          })
        ).status,
      ).toBe(409);
      expect((await snap('A2000002')).status).toBe('AUTO_REJECTED');
    });

    it('example 10: a HIGH-risk approval waits for a checker; it cannot be completed any other way', async () => {
      await own('A2000010', 'applicantA');
      expect((await submit('A2000010')).body.status).toBe('PENDING_CHECKER');
      const waiting = await snap('A2000010');
      expect(waiting).toMatchObject({
        status: 'PENDING_CHECKER',
        account: null,
        rekyc: null,
        recs: [],
      });
      expect(waiting.evals[0]).toMatchObject({ decision: 'APPROVE', risk: 'HIGH' });

      // no bypass: applicants and officers cannot decide it
      expect(
        (
          await call('post', '/applications/A2000010/checker-decision', 'applicantA', {
            action: 'APPROVE',
            comment: 'x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('post', '/applications/A2000010/checker-decision', 'officerA', {
            action: 'APPROVE',
            comment: 'x',
          })
        ).status,
      ).toBe(403);
      expect((await snap('A2000010')).status).toBe('PENDING_CHECKER');

      const done = await call('post', '/applications/A2000010/checker-decision', 'checkerA', {
        action: 'APPROVE',
        comment: 'High-risk approval checked.',
      });
      expect(done.status).toBe(200);
      const s = await snap('A2000010');
      expect(s).toMatchObject({ status: 'APPROVED', decisions: ['APPROVE'], rekyc: '2028-03-04' });
      expect(s.account).not.toBeNull();
      expect(s.statusPath).toEqual([
        'SUBMITTED>EXTRACTING',
        'EXTRACTING>PENDING_CHECKER',
        'PENDING_CHECKER>APPROVED',
      ]);
    });
  });

  describe('review path with field correction (examples 9 and 12) and maker-checker', () => {
    it('submits to IN_REVIEW, the officer corrects the PAN with a reason, the checker approves; the corrector cannot check', async () => {
      await own('A2000009', 'applicantB');
      expect((await submit('A2000009', 'applicantB')).body.status).toBe('IN_REVIEW');
      const reviewed = await snap('A2000009');
      expect(reviewed.evals).toEqual([
        {
          trigger: 'SUBMISSION',
          decision: 'REVIEW',
          codes: ['LOW_EXTRACTION_CONFIDENCE'],
          risk: 'LOW',
          score: 1,
        },
      ]);

      // validation: a reason is mandatory
      const panDoc = await prisma.document.findFirstOrThrow({
        where: { application_id: 'A2000009', declared_doc_type: 'PAN_CARD' },
      });
      const item = { doc_id: panDoc.doc_id, field_name: 'pan_number', new_value: 'ZZTPS9012Y' };
      for (const reason of [undefined, '', '   ']) {
        const bad = await call('post', '/applications/A2000009/corrections', 'officerA', {
          corrections: [reason === undefined ? item : { ...item, reason }],
        });
        expect(bad.status).toBe(400);
        expect(JSON.stringify(bad.body.fields)).toContain('reason');
      }
      const badValue = await call('post', '/applications/A2000009/corrections', 'officerA', {
        corrections: [{ ...item, new_value: 'zztps', reason: 'typo' }],
      });
      expect(badValue.status).toBe(400);
      expect((await snap('A2000009')).corrections).toHaveLength(0);

      // example 12: correct the PAN; rules re-run; case goes to the checker
      const res = await call('post', '/applications/A2000009/corrections', 'officerA', {
        corrections: [{ ...item, reason: 'PAN misread by OCR; verified on the card image' }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        decision: 'APPROVE',
        reason_codes: [],
        status: 'PENDING_CHECKER',
      });

      const s = await snap('A2000009');
      expect(s.status).toBe('PENDING_CHECKER');
      expect(s.evals.map((e) => [e.trigger, e.decision, e.codes])).toEqual([
        ['SUBMISSION', 'REVIEW', ['LOW_EXTRACTION_CONFIDENCE']],
        ['FIELD_CORRECTION', 'APPROVE', []],
      ]);
      expect(s.corrections).toHaveLength(1);
      expect(s.corrections[0]).toMatchObject({
        old_value: 'ZZTP59O12Y',
        new_value: 'ZZTPS9012Y',
        corrected_by: users.officerA.id,
      });
      expect(Number(s.corrections[0]?.old_confidence)).toBe(0.62);
      const field = await prisma.extractedField.findFirstOrThrow({
        where: { doc_id: panDoc.doc_id, field_name: 'pan_number' },
      });
      expect(field).toMatchObject({ value: 'ZZTPS9012Y', source: 'OFFICER' });
      expect(Number(field.confidence)).toBe(1);
      const audit = s.audit.find((a) => a.event_type === 'FIELD_CORRECTED');
      expect(audit).toMatchObject({ actor_user_id: users.officerA.id, doc_id: panDoc.doc_id });
      expect(audit?.before).toMatchObject({ value: 'ZZTP59O12Y', confidence: 0.62 });
      expect(audit?.after).toMatchObject({ value: 'ZZTPS9012Y', confidence: 1, source: 'OFFICER' });
      expect(audit?.details).toMatchObject({
        reason: 'PAN misread by OCR; verified on the card image',
      });

      // a corrected case still needs a checker, and not the person who corrected it
      expect(
        (
          await call('post', '/applications/A2000009/corrections', 'officerA', {
            corrections: [{ ...item, reason: 'again' }],
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await call('post', '/applications/A2000009/checker-decision', 'officerA', {
            action: 'APPROVE',
            comment: 'self check',
          })
        ).status,
      ).toBe(403);
      expect((await snap('A2000009')).status).toBe('PENDING_CHECKER');

      // a compliance officer who is recorded as the corrector is refused as checker (data-level maker-checker)
      await prisma.fieldCorrection.updateMany({
        where: { application_id: 'A2000009' },
        data: { corrected_by: users.checkerA.id },
      });
      const same = await call('post', '/applications/A2000009/checker-decision', 'checkerA', {
        action: 'APPROVE',
        comment: 'self check',
      });
      expect(same.status).toBe(403);
      expect(same.body.error).toBe('MAKER_CHECKER_SAME_USER');
      await prisma.fieldCorrection.updateMany({
        where: { application_id: 'A2000009' },
        data: { corrected_by: users.officerA.id },
      });

      const approved = await call('post', '/applications/A2000009/checker-decision', 'checkerB', {
        action: 'APPROVE',
        comment: 'Correction verified.',
      });
      expect(approved.status).toBe(200);
      const done = await snap('A2000009');
      expect(done).toMatchObject({
        status: 'APPROVED',
        decisions: ['APPROVE'],
        rekyc: '2036-03-04',
      });
      expect(done.account).not.toBeNull();
      expect(done.statusPath).toEqual([
        'SUBMITTED>EXTRACTING',
        'EXTRACTING>IN_REVIEW',
        'IN_REVIEW>PENDING_CHECKER',
        'PENDING_CHECKER>APPROVED',
      ]);
    });
  });

  describe('recommendation, send-back and rejection (example 4, then example 11 rules)', () => {
    it('IN_REVIEW -> PENDING_CHECKER -> sent back -> IN_REVIEW -> PENDING_CHECKER -> REJECTED', async () => {
      await own('A2000004', 'applicantA');
      expect((await submit('A2000004')).body.status).toBe('IN_REVIEW');
      expect((await snap('A2000004')).evals[0]).toMatchObject({
        decision: 'REVIEW',
        codes: ['NAME_MISMATCH_MINOR'],
      });
      expect((await snap('A2000004')).evals[0]?.score).toBeCloseTo(1 - 4 / 17, 12);

      // validation of the comment (at least 10 characters) and of the state
      const short = await call('post', '/applications/A2000004/recommendation', 'officerA', {
        recommendation: 'APPROVE',
        comment: 'ok',
      });
      expect(short.status).toBe(400);
      expect(
        (
          await call('post', '/applications/A2000004/checker-decision', 'checkerA', {
            action: 'APPROVE',
            comment: 'too early',
          })
        ).status,
      ).toBe(409);

      expect(
        (
          await call('post', '/applications/A2000004/recommendation', 'officerA', {
            recommendation: 'APPROVE',
            comment: 'Initials only; same person.',
          })
        ).status,
      ).toBe(201);
      let s = await snap('A2000004');
      expect(s).toMatchObject({ status: 'PENDING_CHECKER', recs: ['APPROVE'], decisions: [] });

      // example 11: the maker cannot check; the checker sends it back
      expect(
        (
          await call('post', '/applications/A2000004/checker-decision', 'officerA', {
            action: 'APPROVE',
            comment: 'me again',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('post', '/applications/A2000004/checker-decision', 'checkerA', {
            action: 'SEND_BACK',
            comment: 'Please check the PAN card image.',
          })
        ).status,
      ).toBe(200);
      s = await snap('A2000004');
      expect(s).toMatchObject({
        status: 'IN_REVIEW',
        decisions: ['SEND_BACK'],
        account: null,
        rekyc: null,
      });

      // second round by another officer, then the checker rejects
      expect(
        (
          await call('post', '/applications/A2000004/recommendation', 'officerB', {
            recommendation: 'REJECT',
            comment: 'Name differs on the PAN card.',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await call('post', '/applications/A2000004/checker-decision', 'checkerB', {
            action: 'REJECT',
            comment: 'Agreed, rejecting.',
          })
        ).status,
      ).toBe(200);
      s = await snap('A2000004');
      expect(s).toMatchObject({
        status: 'REJECTED',
        recs: ['APPROVE', 'REJECT'],
        decisions: ['SEND_BACK', 'REJECT'],
        account: null,
        rekyc: null,
      });
      expect(s.statusPath).toEqual([
        'SUBMITTED>EXTRACTING',
        'EXTRACTING>IN_REVIEW',
        'IN_REVIEW>PENDING_CHECKER',
        'PENDING_CHECKER>IN_REVIEW',
        'IN_REVIEW>PENDING_CHECKER',
        'PENDING_CHECKER>REJECTED',
      ]);

      // final: nothing can move it any more
      for (const [path, who, body] of [
        [
          '/applications/A2000004/recommendation',
          'officerA',
          { recommendation: 'APPROVE', comment: 'Trying after the end.' },
        ],
        [
          '/applications/A2000004/checker-decision',
          'checkerA',
          { action: 'APPROVE', comment: 'Trying after the end.' },
        ],
      ] as const)
        expect([404, 409]).toContain((await call('post', path, who, body)).status);
      expect((await snap('A2000004')).status).toBe('REJECTED');
    });
  });

  describe('resubmission (example 5)', () => {
    const freshBill = {
      name: 'bill.txt',
      content: 'FRESH-BILL electricity bill dated 20-Feb-2026',
      type: 'ELECTRICITY_BILL',
    };
    const upload = async (
      id: string,
      who: Who,
      parts: { name: string; content: string; type: string }[],
    ) => {
      let req = request(t.app)
        .post(`/api/v1/applications/${id}/documents`)
        .set(bearer(await token(who)));
      for (const p of parts)
        req = req
          .attach('files', Buffer.from(p.content), { filename: p.name, contentType: 'text/plain' })
          .field('declared_doc_type', p.type);
      return req;
    };

    it('stale bill -> IN_REVIEW -> resubmission requested (7 days) -> applicant re-uploads -> re-evaluated -> auto-approved', async () => {
      await own('A2000005', 'applicantA');
      expect((await submit('A2000005')).body.status).toBe('IN_REVIEW');
      expect((await snap('A2000005')).evals[0]).toMatchObject({ codes: ['ADDRESS_PROOF_STALE'] });

      const asked = await call('post', '/applications/A2000005/recommendation', 'officerA', {
        recommendation: 'REQUEST_RESUBMISSION',
        comment: 'Please upload a bill from the last 90 days.',
      });
      expect(asked.body).toEqual({ application_id: 'A2000005', status: 'RESUBMISSION_REQUESTED' });
      let s = await snap('A2000005');
      expect(s.status).toBe('RESUBMISSION_REQUESTED');
      expect(s.deadline?.getTime()).toBe(t.clock.now.getTime() + 7 * DAY); // resubmission_sla_days from the configuration

      // cannot resubmit without new documents; officers cannot upload; the applicant can
      expect((await call('post', '/applications/A2000005/resubmit', 'applicantA')).body.error).toBe(
        'NO_NEW_DOCUMENTS',
      );
      expect((await upload('A2000005', 'officerA', [freshBill])).status).toBe(403);
      const up = await upload('A2000005', 'applicantA', [freshBill]);
      expect(up.status).toBe(201);
      const fresh = await prisma.document.findFirstOrThrow({
        where: { doc_id: up.body.documents[0].doc_id },
      });
      expect(fresh.submission_round).toBe(2);

      const res = await call('post', '/applications/A2000005/resubmit', 'applicantA');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('AUTO_APPROVED'); // the new bill supersedes the stale one
      s = await snap('A2000005');
      expect(s).toMatchObject({
        status: 'AUTO_APPROVED',
        round: 2,
        deadline: null,
        rekyc: '2036-03-04',
      });
      expect(s.evals.map((e) => [e.trigger, e.decision, e.codes])).toEqual([
        ['SUBMISSION', 'REVIEW', ['ADDRESS_PROOF_STALE']],
        ['RESUBMISSION', 'APPROVE', []],
      ]);
      expect(s.account).not.toBeNull();
      expect(s.statusPath).toEqual([
        'SUBMITTED>EXTRACTING',
        'EXTRACTING>IN_REVIEW',
        'IN_REVIEW>RESUBMISSION_REQUESTED',
        'RESUBMISSION_REQUESTED>SUBMITTED',
        'SUBMITTED>EXTRACTING',
        'EXTRACTING>AUTO_APPROVED',
      ]);
    });

    it('no resubmission within 7 days: the request expires to CLOSED_EXPIRED (final) and uploads are refused', async () => {
      await own('A2000007', 'applicantA');
      await submit('A2000007');
      await call('post', '/applications/A2000007/recommendation', 'officerA', {
        recommendation: 'REQUEST_RESUBMISSION',
        comment: 'Upload a clearer identity proof.',
      });
      expect((await snap('A2000007')).status).toBe('RESUBMISSION_REQUESTED');

      t.clock.now = new Date(t.clock.now.getTime() + 8 * DAY);
      tokens.clear(); // the 60-minute sessions of the day before have expired: sign in again
      try {
        expect((await upload('A2000007', 'applicantA', [freshBill])).status).toBe(409); // window closed
        expect((await call('post', '/admin/expire-overdue', 'officerA')).status).toBe(403);
        const expired = await call('post', '/admin/expire-overdue', 'checkerA');
        expect(expired.body.expired).toContain('A2000007');
        const s = await snap('A2000007');
        expect(s.status).toBe('CLOSED_EXPIRED');
        expect(s.statusPath.at(-1)).toBe('RESUBMISSION_REQUESTED>CLOSED_EXPIRED');
        expect((await call('post', '/applications/A2000007/resubmit', 'applicantA')).status).toBe(
          409,
        );
        expect((await snap('A2000007')).status).toBe('CLOSED_EXPIRED');
      } finally {
        t.clock.now = new Date(t.clock.now.getTime() - 8 * DAY);
      }
    });

    it('resubmitting after the deadline closes the case and answers 409 RESUBMISSION_EXPIRED', async () => {
      await own('A2000008', 'applicantA');
      await submit('A2000008');
      await call('post', '/applications/A2000008/recommendation', 'officerA', {
        recommendation: 'REQUEST_RESUBMISSION',
        comment: 'Upload the Aadhaar card too.',
      });
      await upload('A2000008', 'applicantA', [freshBill]);
      t.clock.now = new Date(t.clock.now.getTime() + 8 * DAY);
      tokens.clear(); // the 60-minute sessions of the day before have expired: sign in again
      try {
        const res = await call('post', '/applications/A2000008/resubmit', 'applicantA');
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('RESUBMISSION_EXPIRED');
        expect((await snap('A2000008')).status).toBe('CLOSED_EXPIRED');
      } finally {
        t.clock.now = new Date(t.clock.now.getTime() - 8 * DAY);
      }
    });
  });

  describe('conflicting actions (optimistic locking, HTTP 409)', () => {
    it('two simultaneous submissions of one case: exactly one succeeds', async () => {
      const [id] = spare('APPROVE', 1) as [string];
      await own(id, 'applicantA');
      const results = await Promise.all([submit(id), submit(id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const s = await snap(id);
      expect(s.evals).toHaveLength(1);
      expect(s.statusPath.filter((p) => p === 'SUBMITTED>EXTRACTING')).toHaveLength(1);
    });

    it('a recommendation and a correction on the same case at the same time: one wins, the other gets 409 and leaves nothing behind', async () => {
      const [id] = spare('REVIEW', 1) as [string];
      await own(id, 'applicantA');
      expect((await submit(id)).body.status).toBe('IN_REVIEW');
      const doc = await prisma.document.findFirstOrThrow({
        where: { application_id: id },
        orderBy: { doc_id: 'asc' },
      });
      const [rec, cor] = await Promise.all([
        call('post', `/applications/${id}/recommendation`, 'officerA', {
          recommendation: 'APPROVE',
          comment: 'Looks fine to me.',
        }),
        call('post', `/applications/${id}/corrections`, 'officerB', {
          corrections: [
            {
              doc_id: doc.doc_id,
              field_name: 'gender',
              new_value: 'M',
              reason: 'Checked against the card',
            },
          ],
        }),
      ]);
      expect([rec.status, cor.status].filter((s) => s === 409)).toHaveLength(1);
      const s = await snap(id);
      expect(s.status).toBe('PENDING_CHECKER');
      // exactly one of the two actions is recorded
      expect(s.recs.length + s.corrections.length).toBe(1);
      expect(s.statusPath.filter((p) => p === 'IN_REVIEW>PENDING_CHECKER')).toHaveLength(1);
    });
  });

  describe('re-screening open cases when a watchlist changes', () => {
    it('adds a sanctions entry equal to an open applicant, then re-screens on request: new evaluation, status untouched, audited', async () => {
      const [id] = spare('REVIEW', 2).slice(1) as [string];
      await own(id, 'applicantB');
      expect((await submit(id, 'applicantB')).body.status).toBe('IN_REVIEW');
      const app = await prisma.application.findUniqueOrThrow({ where: { application_id: id } });
      const before = await snap(id);

      const entry = {
        list_id: 'SAN9100',
        name: app.full_name,
        nationality: 'XA',
        program: 'FICTIONAL-FRAUD-RING',
        dob: app.dob.toISOString().slice(0, 10),
      };
      expect((await call('post', '/admin/watchlists/sanctions', 'officerA', entry)).status).toBe(
        403,
      );
      expect((await call('post', '/admin/watchlists/sanctions', 'checkerA', entry)).status).toBe(
        201,
      );
      expect((await call('post', '/admin/rescreen', 'officerA')).status).toBe(403);

      const res = await call('post', '/admin/rescreen', 'checkerA');
      expect(res.status).toBe(200);
      const change = (
        res.body.changed as {
          application_id: string;
          after: { decision: string; reason_codes: string[] };
        }[]
      ).find((c) => c.application_id === id);
      expect(change?.after).toMatchObject({ decision: 'REJECT' });
      expect(change?.after.reason_codes).toContain('SANCTIONS_MATCH');

      const after = await snap(id);
      expect(after.status).toBe('IN_REVIEW'); // the officer decides what to do with a new hit
      expect(after.version).toBe(before.version);
      expect(after.evals).toHaveLength(before.evals.length + 1);
      expect(after.evals.at(-1)).toMatchObject({ trigger: 'RESCREEN', decision: 'REJECT' });
      const hit = await prisma.screeningMatch.findFirstOrThrow({
        where: { application_id: id, entry_id: 'SAN9100' },
      });
      expect(hit).toMatchObject({ list_type: 'SANCTIONS', result: 'MATCH' });
      expect(
        after.audit.some(
          (a) =>
            a.event_type === 'WATCHLIST_HIT' &&
            (a.details as { entry_id?: string }).entry_id === 'SAN9100',
        ),
      ).toBe(true);
      // the officer sees the screening result and the rule trace on the case
      const view = await call('get', `/applications/${id}`, 'officerA');
      expect(view.body.evaluation.screening).toEqual(
        expect.arrayContaining([expect.objectContaining({ entry_id: 'SAN9100', result: 'MATCH' })]),
      );
      expect(view.body.evaluation.trace).toHaveLength(17);
      expect(
        (await call('get', `/applications/${id}`, 'applicantB')).body.evaluation,
      ).toBeUndefined();
    });
  });

  describe('re-KYC tracking', () => {
    it('lists approved customers whose re-KYC falls due within the window', async () => {
      const soon = await call('get', '/admin/rekyc-due?days=30', 'checkerA');
      expect(soon.status).toBe(200);
      expect(soon.body.customers).toEqual([]);
      const all = await call('get', '/admin/rekyc-due?days=4000', 'checkerA');
      const byId = Object.fromEntries(
        (all.body.customers as { application_id: string; rekyc_due_date: string }[]).map((c) => [
          c.application_id,
          c.rekyc_due_date,
        ]),
      );
      expect(byId).toMatchObject({
        A2000001: '2036-03-04',
        A2000010: '2028-03-04',
        A2000009: '2036-03-04',
      });
      expect((await call('get', '/admin/rekyc-due', 'officerA')).status).toBe(403);
      // 2028-03-04 is due within ~1,600 days but not within 30
      expect(
        (
          (await call('get', '/admin/rekyc-due?days=1500', 'checkerA')).body.customers as {
            application_id: string;
          }[]
        ).map((c) => c.application_id),
      ).toContain('A2000010');
    });
  });

  describe('application form and submission by the applicant', () => {
    const form = {
      full_name: 'Meera Pillai',
      dob: '1992-07-21',
      gender: 'F',
      pan_number: 'ZZMPP4321K',
      aadhaar_last4: '0937',
      mobile: '9876543210',
      email: 'meera@example.com',
      address: 'Flat 4, Palm Court, Kochi',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
      occupation_code: 'SALARIED_PRIVATE',
      annual_income: 1200000,
      consent_kyc: true,
    };
    const fieldsOf = (r: request.Response) =>
      (r.body.fields as { field: string; message: string }[]).map((f) => f.field).sort();

    it('refuses invalid input with the field names, including a full 12-digit Aadhaar number', async () => {
      const bad = await call('post', '/applications', 'applicantA', {
        ...form,
        aadhaar_last4: '123456789012',
        mobile: '1234567890',
        pincode: '012345',
        dob: '2999-01-01',
        pan_number: 'bad',
        consent_kyc: false,
        annual_income: -5,
      });
      expect(bad.status).toBe(400);
      expect(fieldsOf(bad)).toEqual([
        'aadhaar_last4',
        'annual_income',
        'consent_kyc',
        'dob',
        'mobile',
        'pan_number',
        'pincode',
      ]);
      const aadhaar = (bad.body.fields as { field: string; message: string }[]).find(
        (f) => f.field === 'aadhaar_last4',
      );
      expect(aadhaar?.message).toMatch(/last 4 digits.*full 12-digit/i);
      expect(
        (
          await call('post', '/applications', 'applicantA', {
            ...form,
            occupation_code: 'ASTRONAUT',
          })
        ).status,
      ).toBe(400);
      expect(
        (await call('post', '/applications', 'applicantA', { ...form, role: 'COMPLIANCE_OFFICER' }))
          .status,
      ).toBe(400); // unknown field
      expect((await call('post', '/applications', 'officerA', form)).status).toBe(403);
      expect(await prisma.application.count({ where: { dataset: 'LIVE' } })).toBe(0);
    });

    it('creates the application, accepts documents, and routes it after submission (an unknown document means REVIEW)', async () => {
      const created = await call('post', '/applications', 'applicantA', form);
      expect(created.status).toBe(201);
      const id = created.body.application_id as string;
      expect(id).toMatch(/^A4\d{6}$/);
      const row = await prisma.application.findUniqueOrThrow({ where: { application_id: id } });
      expect(row).toMatchObject({
        status: 'SUBMITTED',
        dataset: 'LIVE',
        applicant_user_id: users.applicantA.id,
        kyc_consent: true,
        aadhaar_last4: '0937',
        submission_round: 1,
      });
      expect(row.application_date.toISOString().slice(0, 10)).toBe(
        new Date(t.clock.now.getTime() + 330 * 60_000).toISOString().slice(0, 10),
      );
      expect((await snap(id)).auditTypes).toEqual(['STATUS_CHANGED']);

      // no documents yet
      const empty = await submit(id);
      expect(empty.status).toBe(422);
      expect(empty.body.error).toBe('NO_DOCUMENTS');

      // another applicant cannot touch it
      expect((await submit(id, 'applicantB')).status).toBe(404);

      let req = request(t.app)
        .post(`/api/v1/applications/${id}/documents`)
        .set(bearer(await token('applicantA')));
      for (const [i, type] of ['PAN_CARD', 'AADHAAR_CARD', 'ELECTRICITY_BILL'].entries())
        req = req
          .attach('files', Buffer.from(`document text number ${i}`), {
            filename: `d${i}.txt`,
            contentType: 'text/plain',
          })
          .field('declared_doc_type', type);
      expect((await req).status).toBe(201);

      const res = await submit(id);
      expect(res.status).toBe(200);
      // the mock provider does not know these new documents (OTHER, 0.00), so the rules route the case to a person
      expect(res.body.status).toBe('IN_REVIEW');
      const s = await snap(id);
      expect(s.evals[0]).toMatchObject({ decision: 'REVIEW' });
      expect(s.evals[0]?.codes).toEqual(
        expect.arrayContaining([
          'DOCUMENT_MISSING',
          'DOCUMENT_TYPE_MISMATCH',
          'LOW_EXTRACTION_CONFIDENCE',
        ]),
      );
      expect(s.statusPath).toEqual(['->SUBMITTED', 'SUBMITTED>EXTRACTING', 'EXTRACTING>IN_REVIEW']);
    });
  });
});
