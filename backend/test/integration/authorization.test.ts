import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { createWorld, type World } from '../support/world.js';

describeDb('authorisation', () => {
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

  const get = (path: string, token: string) => request(t.app).get(path).set(bearer(token));
  const post = (path: string, token: string, body: object = {}) =>
    request(t.app).post(path).set(bearer(token)).send(body);
  const as = (key: keyof World['users']) => t.login(world.users[key].email);

  describe('applicant accessing another applicant’s application (IDOR)', () => {
    it('gets 404 for the other person’s case, identical to a case that does not exist', async () => {
      const token = await as('applicantA');
      const other = await get(`/api/v1/applications/${world.apps.otherReview}`, token);
      const missing = await get('/api/v1/applications/T999999', token);
      expect(other.status).toBe(404);
      expect(other.body).toEqual(missing.body);
      expect(JSON.stringify(other.body)).not.toContain('Name T000002');
    });

    it.each([
      ['detail', (id: string) => `/api/v1/applications/${id}`],
      ['document list', (id: string) => `/api/v1/applications/${id}/documents`],
    ])(
      'swapping the application id in the %s URL never exposes another applicant’s data',
      async (_n, path) => {
        const token = await as('applicantA');
        for (const id of [
          world.apps.otherReview,
          world.apps.pending,
          'T999999',
          '../T000001',
          'T000002%00',
        ]) {
          const res = await get(path(encodeURIComponent(id)), token);
          expect(res.status).toBe(404);
        }
      },
    );

    it('can still read their own application', async () => {
      const res = await get(`/api/v1/applications/${world.apps.review}`, await as('applicantA'));
      expect(res.status).toBe(200);
      expect(res.body.application_id).toBe('T000001');
    });

    it('sees only their own applications in the list', async () => {
      const res = await get('/api/v1/applications/mine', await as('applicantA'));
      expect(res.status).toBe(200);
      expect(
        (res.body.applications as { application_id: string }[]).map((a) => a.application_id).sort(),
      ).toEqual(['T000001', 'T000003']);
    });

    it('records the denied attempt in the audit log', async () => {
      const token = await as('applicantA');
      await get(`/api/v1/applications/${world.apps.otherReview}`, token);
      const denied = await prisma.auditEvent.findMany({ where: { event_type: 'ACCESS_DENIED' } });
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        actor_user_id: world.users.applicantA.id,
        actor_role: 'APPLICANT',
        application_id: 'T000002',
      });
    });
  });

  describe('applicant calling an officer-only endpoint gets 403', () => {
    it.each([
      ['get', '/api/v1/review/queue'],
      ['post', '/api/v1/applications/T000001/recommendation'],
      ['post', '/api/v1/applications/T000004/checker-decision'],
      ['get', '/api/v1/admin/rule-config'],
      ['get', '/api/v1/admin/watchlists/sanctions'],
      ['get', '/api/v1/admin/audit/T000001'],
    ])('%s %s', async (method, path) => {
      const res = await request(t.app)
        [method as 'get' | 'post'](path)
        .set(bearer(await as('applicantA')))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN_ROLE');
    });

    it('officers cannot use the applicant-only list either', async () => {
      expect((await get('/api/v1/applications/mine', await as('officerA'))).status).toBe(403);
    });
  });

  describe('officers and checkers: actions outside their role get 403', () => {
    it('a KYC officer cannot make a checker decision', async () => {
      const res = await post(
        `/api/v1/applications/${world.apps.pending}/checker-decision`,
        await as('officerB'),
        { action: 'APPROVE', comment: 'Looks fine to me' },
      );
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN_ROLE');
      expect(
        (await prisma.application.findUniqueOrThrow({ where: { application_id: 'T000004' } }))
          .status,
      ).toBe('PENDING_CHECKER');
    });

    it('a compliance officer cannot make a recommendation (maker role)', async () => {
      const res = await post(
        `/api/v1/applications/${world.apps.review}/recommendation`,
        await as('checkerA'),
        { recommendation: 'APPROVE', comment: 'Everything matches.' },
      );
      expect(res.status).toBe(403);
    });

    it('a KYC officer cannot maintain reference data or read the audit trail', async () => {
      const token = await as('officerA');
      expect((await get('/api/v1/admin/rule-config', token)).status).toBe(403);
      expect((await get('/api/v1/admin/audit/T000001', token)).status).toBe(403);
    });

    it('a KYC officer sees review cases but not applications outside the review pipeline', async () => {
      const token = await as('officerA');
      expect((await get(`/api/v1/applications/${world.apps.review}`, token)).status).toBe(200);
      expect((await get(`/api/v1/applications/${world.apps.submitted}`, token)).status).toBe(404);
    });

    it('a compliance officer can see any application', async () => {
      expect(
        (await get(`/api/v1/applications/${world.apps.submitted}`, await as('checkerA'))).status,
      ).toBe(200);
    });
  });

  describe('document access', () => {
    const doc = (app: string, d: string) => `/api/v1/applications/${app}/documents/${d}`;

    it('without a token: 401', async () => {
      expect((await request(t.app).get(doc('T000001', 'DT000001'))).status).toBe(401);
    });

    it('another applicant: 404 and no text', async () => {
      const res = await get(doc('T000001', 'DT000001'), await as('applicantB'));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('RAVI KUMAR SHARMA');
    });

    it('own application but a document id from someone else’s application: 404', async () => {
      const res = await get(doc('T000001', world.docs.otherReviewPan), await as('applicantA'));
      expect(res.status).toBe(404);
    });

    it('a KYC officer outside the case scope: 404', async () => {
      expect((await get(doc('T000003', 'DT000004'), await as('officerA'))).status).toBe(404);
    });

    it('the owner can read the text, and the view is audited with user, role, doc id and time', async () => {
      const res = await get(doc('T000001', 'DT000001'), await as('applicantA'));
      expect(res.status).toBe(200);
      expect(res.body.text).toContain('RAVI KUMAR SHARMA');
      const views = await prisma.auditEvent.findMany({ where: { event_type: 'DOCUMENT_VIEWED' } });
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        actor_user_id: world.users.applicantA.id,
        actor_role: 'APPLICANT',
        doc_id: 'DT000001',
        application_id: 'T000001',
      });
      expect(views[0]?.created_at).toBeInstanceOf(Date);
    });

    it('an authorised officer can read it, and that view is audited too', async () => {
      const res = await get(doc('T000001', 'DT000002'), await as('officerA'));
      expect(res.status).toBe(200);
      const view = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'DOCUMENT_VIEWED' },
      });
      expect(view).toMatchObject({ actor_role: 'KYC_OFFICER', doc_id: 'DT000002' });
    });

    it('listing documents does not return their text', async () => {
      const res = await get('/api/v1/applications/T000001/documents', await as('applicantA'));
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('RAVI KUMAR SHARMA');
      expect(res.body.documents).toHaveLength(2);
    });

    it('never writes document text to the request log', async () => {
      await get(doc('T000001', 'DT000001'), await as('applicantA'));
      expect(t.logs.join('\n')).not.toContain('RAVI KUMAR SHARMA');
    });
  });

  describe('what each role may see', () => {
    it('applicants get no confidence scores, screening or recommendations, and a masked PAN', async () => {
      const res = await get(`/api/v1/applications/${world.apps.review}`, await as('applicantA'));
      const text = JSON.stringify(res.body);
      expect(res.body.pan_masked).toBe('ZZKXXXXX4Q');
      expect(text).not.toContain('ZZKPS1234Q');
      expect(text).not.toMatch(/confidence|screening|evaluation|recommendation/i);
      expect(res.body.aadhaar_masked).toBe('XXXXXXXX4821');
    });

    it('officers get extracted fields with confidence for the case screen', async () => {
      const res = await get(`/api/v1/applications/${world.apps.review}`, await as('officerA'));
      expect(res.status).toBe(200);
      const pan = (
        res.body.documents as {
          doc_id: string;
          extracted_fields: { field_name: string; confidence: number }[];
        }[]
      )
        .find((d) => d.doc_id === 'DT000001')
        ?.extracted_fields.find((f) => f.field_name === 'pan_number');
      expect(pan?.confidence).toBe(0.93);
    });

    it('the review queue lists masked PANs only, per role', async () => {
      const kyc = await get('/api/v1/review/queue', await as('officerA'));
      expect(kyc.body.queue).toBe('IN_REVIEW');
      expect(
        (kyc.body.applications as { application_id: string }[]).map((a) => a.application_id).sort(),
      ).toEqual(['T000001', 'T000002']);
      const checker = await get('/api/v1/review/queue', await as('checkerA'));
      expect(checker.body.queue).toBe('PENDING_CHECKER');
      for (const body of [kyc.body, checker.body]) {
        const text = JSON.stringify(body);
        expect(text).toMatch(/ZZ[A-Z]XXXXX\d[A-Z]/);
        expect(text).not.toMatch(/ZZ[A-Z]{2}\d{4}[A-Z]/);
      }
    });
  });
});
