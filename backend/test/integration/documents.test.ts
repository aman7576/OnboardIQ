import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExtractionProvider } from '../../src/modules/extraction/provider.js';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, SERVICE_KEY, type TestApp } from '../support/http.js';
import { loadRealWorld, mockRows, realText, type Who } from '../support/real-data.js';
import { PASSWORD } from '../support/world.js';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describeDb('document upload and extraction (real supplied data)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  let users: Record<Who, { id: string; email: string }>;
  let counter = 0;

  beforeAll(async () => {
    prisma = testPrisma();
    await truncateAll(prisma);
    users = await loadRealWorld(prisma);
    t = buildApp(prisma);
  });
  afterAll(() => prisma.$disconnect());

  const token = (who: Who, app: TestApp = t) => app.login(users[who].email, PASSWORD);
  /** A fresh SUBMITTED application with no documents, owned by applicantA (isolates each upload test). */
  async function newApplication(owner: Who = 'applicantA'): Promise<string> {
    const id = `T9${String(++counter).padStart(5, '0')}`;
    const template = await prisma.application.findUniqueOrThrow({
      where: { application_id: 'A2000001' },
    });
    await prisma.application.create({
      data: {
        application_id: id,
        dataset: template.dataset,
        application_date: template.application_date,
        full_name: template.full_name,
        dob: template.dob,
        gender: template.gender,
        pan_number: template.pan_number,
        aadhaar_last4: template.aadhaar_last4,
        mobile: template.mobile,
        email: template.email,
        address: template.address,
        city: template.city,
        state: template.state,
        pincode: template.pincode,
        occupation_code: template.occupation_code,
        annual_income: template.annual_income,
        applicant_user_id: users[owner].id,
        status: 'SUBMITTED',
      },
    });
    return id;
  }
  type Part = { name: string; content: Buffer | string; type?: string; mime?: string };
  const upload = async (appId: string, parts: Part[], bearerToken: string, app: TestApp = t) => {
    let req = request(app.app)
      .post(`/api/v1/applications/${appId}/documents`)
      .set(bearer(bearerToken));
    for (const p of parts)
      req = req.attach('files', Buffer.from(p.content), {
        filename: p.name,
        contentType: p.mime ?? 'text/plain',
      });
    for (const p of parts) req = req.field('declared_doc_type', p.type ?? 'PAN_CARD');
    return req;
  };
  const threeRealDocs: Part[] = [
    { name: 'pan.txt', content: realText('D3000001'), type: 'PAN_CARD' },
    { name: 'aadhaar.txt', content: realText('D3000002'), type: 'AADHAAR_CARD' },
    { name: 'bill.txt', content: realText('D3000003'), type: 'ELECTRICITY_BILL' },
  ];
  const extract = (docId: string, key = SERVICE_KEY) =>
    request(t.app).post(`/api/v1/documents/${docId}/extract`).set('x-service-key', key);

  describe('upload', () => {
    it('stores a valid submission: rows, SHA-256, declared types, file on disk (0600), uploader and audit', async () => {
      const appId = await newApplication();
      const res = await upload(appId, threeRealDocs, await token('applicantA'));
      expect(res.status).toBe(201);
      const docs = res.body.documents as {
        doc_id: string;
        sha256: string;
        declared_doc_type: string;
        duplicate: boolean;
        file_name: string;
      }[];
      expect(docs.map((d) => d.declared_doc_type)).toEqual([
        'PAN_CARD',
        'AADHAAR_CARD',
        'ELECTRICITY_BILL',
      ]);
      expect(
        docs.every(
          (d) => !d.duplicate && d.doc_id !== 'D3000001' && d.file_name === `${d.doc_id}.txt`,
        ),
      ).toBe(true);
      expect(docs.map((d) => d.sha256)).toEqual(threeRealDocs.map((p) => sha(String(p.content))));

      const rows = await prisma.document.findMany({
        where: { application_id: appId },
        orderBy: { doc_id: 'asc' },
      });
      expect(rows).toHaveLength(3);
      expect(
        rows.every((r) => r.uploaded_by === users.applicantA.id && r.dataset === 'SAMPLE'),
      ).toBe(true);
      const onDisk = join(t.storageDir, appId, `${docs[0]?.doc_id}.txt`);
      expect(readFileSync(onDisk, 'utf8')).toBe(realText('D3000001'));
      expect(statSync(onDisk).mode & 0o777).toBe(0o600);
      expect(onDisk.startsWith(t.storageDir)).toBe(true);
      expect(
        await prisma.auditEvent.count({
          where: { application_id: appId, event_type: 'DOCUMENT_UPLOADED' },
        }),
      ).toBe(3);
    });

    it('rejects an oversized file (1 MB + 1 byte) with 422 and stores nothing', async () => {
      const appId = await newApplication();
      const big = {
        name: 'big.txt',
        content: Buffer.alloc(1024 * 1024 + 1, 'a'),
        type: 'BANK_STATEMENT',
      };
      const res = await upload(
        appId,
        [...threeRealDocs.slice(0, 2), big],
        await token('applicantA'),
      );
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
      expect(res.body.fields).toEqual([expect.objectContaining({ field: 'files[2]' })]);
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(0);
    });

    it('rejects a far larger file at the parser as well (413-class case still answers 422)', async () => {
      const appId = await newApplication();
      const res = await upload(
        appId,
        [
          ...threeRealDocs.slice(0, 2),
          { name: 'huge.txt', content: Buffer.alloc(3 * 1024 * 1024, 'a') },
        ],
        await token('applicantA'),
      );
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('FILE_TOO_LARGE');
    });

    it('rejects invalid UTF-8 with 422 INVALID_ENCODING', async () => {
      const appId = await newApplication();
      const bad = {
        name: 'latin1.txt',
        content: Buffer.from([0x52, 0xe9, 0x73, 0xff, 0xfe]),
        type: 'BANK_STATEMENT',
      };
      const res = await upload(
        appId,
        [...threeRealDocs.slice(0, 2), bad],
        await token('applicantA'),
      );
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('INVALID_ENCODING');
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(0);
    });

    it('rejects unsupported files (image, pdf) with 422 UNSUPPORTED_FILE_TYPE', async () => {
      const appId = await newApplication();
      const png = {
        name: 'scan.png',
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
        mime: 'image/png',
      };
      const pdf = { name: 'doc.pdf', content: '%PDF-1.4 fake', mime: 'application/pdf' };
      const res = await upload(
        appId,
        [threeRealDocs[0] as Part, png, pdf],
        await token('applicantA'),
      );
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('UNSUPPORTED_FILE_TYPE');
      expect((res.body.fields as unknown[]).length).toBe(2);
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(0);
    });

    it('rejects a first submission with fewer than 3 files, and an unknown declared type', async () => {
      const appId = await newApplication();
      const two = await upload(appId, threeRealDocs.slice(0, 2), await token('applicantA'));
      expect(two.status).toBe(422);
      expect(two.body.error).toBe('TOO_FEW_FILES');
      const badType = await upload(
        appId,
        threeRealDocs.map((p, i) => (i === 0 ? { ...p, type: 'PASSPORT' } : p)),
        await token('applicantA'),
      );
      expect(badType.status).toBe(422);
      expect(badType.body.fields).toEqual([
        expect.objectContaining({ field: 'declared_doc_type[0]' }),
      ]);
    });

    it('does not store a duplicate: the same file again returns the original document (200)', async () => {
      const appId = await newApplication();
      const first = await upload(appId, threeRealDocs, await token('applicantA'));
      const again = await upload(appId, [threeRealDocs[0] as Part], await token('applicantA'));
      expect(again.status).toBe(200);
      expect(again.body.documents[0]).toMatchObject({
        duplicate: true,
        doc_id: first.body.documents[0].doc_id,
      });
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(3);
    });

    it('also de-duplicates the same file sent twice in one request', async () => {
      const appId = await newApplication();
      const res = await upload(
        appId,
        [...threeRealDocs, { ...(threeRealDocs[0] as Part), name: 'copy-of-pan.txt' }],
        await token('applicantA'),
      );
      expect(res.status).toBe(201);
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(3);
    });

    it('lets two different applications each hold the same file', async () => {
      const a = await newApplication();
      const b = await newApplication('applicantB');
      expect((await upload(a, threeRealDocs, await token('applicantA'))).status).toBe(201);
      expect((await upload(b, threeRealDocs, await token('applicantB'))).status).toBe(201);
    });

    it('is refused to others: no token 401, another applicant 404, an officer 403; wrong state 409', async () => {
      const appId = await newApplication();
      expect((await request(t.app).post(`/api/v1/applications/${appId}/documents`)).status).toBe(
        401,
      );
      expect((await upload(appId, threeRealDocs, await token('applicantB'))).status).toBe(404);
      expect((await upload(appId, threeRealDocs, await token('officerA'))).status).toBe(403);
      await prisma.application.update({
        where: { application_id: appId },
        data: { status: 'APPROVED' },
      });
      expect((await upload(appId, threeRealDocs, await token('applicantA'))).status).toBe(409);
      expect(await prisma.document.count({ where: { application_id: appId } })).toBe(0);
    });
  });

  describe('authorised retrieval and audited views', () => {
    it('the owner reads an uploaded file back and the view is audited', async () => {
      const appId = await newApplication();
      const up = await upload(appId, threeRealDocs, await token('applicantA'));
      const docId = up.body.documents[0].doc_id as string;
      const res = await request(t.app)
        .get(`/api/v1/applications/${appId}/documents/${docId}`)
        .set(bearer(await token('applicantA')));
      expect(res.status).toBe(200);
      expect(res.body.text).toBe(realText('D3000001'));
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const view = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'DOCUMENT_VIEWED', doc_id: docId },
      });
      expect(view).toMatchObject({ actor_user_id: users.applicantA.id, actor_role: 'APPLICANT' });
    });

    it('another applicant cannot read it (404)', async () => {
      const res = await request(t.app)
        .get('/api/v1/applications/A2000001/documents/D3000001')
        .set(bearer(await token('applicantB')));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/documents/{doc_id}/extract (mock provider)', () => {
    it('returns the supplied mock rows for a document: type, fields and confidence, plus provider metadata', async () => {
      const res = await extract('D3000001');
      expect(res.status).toBe(200);
      const supplied = mockRows('D3000001');
      expect(res.body).toMatchObject({
        doc_id: 'D3000001',
        provider: 'MOCK',
        doc_type: 'PAN_CARD',
        doc_type_confidence: 0.97,
        degraded: false,
        persisted: true,
      });
      expect(res.body.extractor_version).toBe('mock:case_02_extraction_mock_sample_V1.0.csv');
      // long format: doc_type row first, then each field exactly as supplied
      const byName = (a: { field_name: string }, b: { field_name: string }) =>
        a.field_name === 'doc_type'
          ? -1
          : b.field_name === 'doc_type'
            ? 1
            : a.field_name.localeCompare(b.field_name);
      expect(res.body.rows).toEqual(
        supplied
          .map((r) => ({
            doc_id: r.doc_id,
            field_name: r.field_name,
            value: r.value,
            confidence: Number(r.confidence),
          }))
          .sort(byName),
      );
    });

    it('is persisted once per provider version, with provider and version recorded', async () => {
      await extract('D3000004');
      await extract('D3000004');
      const runs = await prisma.extraction.findMany({
        where: { doc_id: 'D3000004' },
        include: { fields: true },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        provider: 'MOCK',
        extractor_version: 'mock:case_02_extraction_mock_sample_V1.0.csv',
      });
      expect(runs[0]?.fields).toHaveLength(mockRows('D3000004').length);
    });

    it('low-confidence extraction: misread value and 0.62 confidence come back unchanged (not corrected, not hidden)', async () => {
      const res = await extract('D3000025');
      expect(res.status).toBe(200);
      expect(
        res.body.fields.find((f: { field_name: string }) => f.field_name === 'pan_number'),
      ).toEqual({ field_name: 'pan_number', value: 'ZZTP59O12Y', confidence: 0.62 });
      const stored = await prisma.extractedField.findFirstOrThrow({
        where: { doc_id: 'D3000025', field_name: 'pan_number' },
      });
      expect(Number(stored.confidence)).toBe(0.62);
    });

    it('unknown document id: OTHER with confidence 0.00, nothing stored (service call)', async () => {
      const res = await extract('D9999999');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        doc_type: 'OTHER',
        doc_type_confidence: 0,
        persisted: false,
        fields: [],
      });
      expect(await prisma.extraction.count({ where: { doc_id: 'D9999999' } })).toBe(0);
    });

    it('unknown document id for an officer is a plain 404', async () => {
      const res = await request(t.app)
        .post('/api/v1/documents/D9999999/extract')
        .set(bearer(await token('officerA')));
      expect(res.status).toBe(404);
    });

    it('a stored document the mock files do not know (a new upload) is OTHER with confidence 0.00, and stored', async () => {
      const appId = await newApplication();
      const up = await upload(appId, threeRealDocs, await token('applicantA'));
      const docId = up.body.documents[0].doc_id as string;
      const res = await extract(docId);
      expect(res.body).toMatchObject({
        doc_type: 'OTHER',
        doc_type_confidence: 0,
        extractor_version: 'mock:unknown',
        persisted: true,
      });
      expect(
        (await prisma.extraction.findFirstOrThrow({ where: { doc_id: docId } })).extractor_version,
      ).toBe('mock:unknown');
    });

    it('an officer in scope can run it (audited as that officer); out of scope gets 404; a repeat adds nothing', async () => {
      const appId = await newApplication();
      const up = await upload(appId, threeRealDocs, await token('applicantA'));
      const docId = up.body.documents[0].doc_id as string;
      await prisma.application.update({
        where: { application_id: appId },
        data: { status: 'IN_REVIEW' },
      });
      const officer = await token('officerA');
      const ok = await request(t.app)
        .post(`/api/v1/documents/${docId}/extract`)
        .set(bearer(officer));
      expect(ok.status).toBe(200);
      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { event_type: 'EXTRACTION_RECORDED', doc_id: docId },
      });
      expect(event).toMatchObject({ actor_user_id: users.officerA.id, actor_role: 'KYC_OFFICER' });
      await request(t.app).post(`/api/v1/documents/${docId}/extract`).set(bearer(officer));
      expect(await prisma.extraction.count({ where: { doc_id: docId } })).toBe(1);
      expect(
        await prisma.auditEvent.count({
          where: { event_type: 'EXTRACTION_RECORDED', doc_id: docId },
        }),
      ).toBe(1);

      const out = await request(t.app)
        .post('/api/v1/documents/D3000001/extract')
        .set(bearer(officer)); // case is SUBMITTED
      expect(out.status).toBe(404);
    });
  });

  describe('unauthorised extraction', () => {
    it.each([
      ['no credentials', (r: request.Test) => r, 401],
      ['wrong service key', (r: request.Test) => r.set('x-service-key', 'not-the-key'), 401],
    ])('%s -> %i', async (_name, decorate, status) => {
      const res = await decorate(request(t.app).post('/api/v1/documents/D3000001/extract'));
      expect(res.status).toBe(status);
    });

    it('an applicant (even the owner) gets 403 and no confidence data', async () => {
      const res = await request(t.app)
        .post('/api/v1/documents/D3000001/extract')
        .set(bearer(await token('applicantA')));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(/confidence/);
    });

    it('a user token with a bad service key header is still refused (the key is checked, not skipped)', async () => {
      const res = await request(t.app)
        .post('/api/v1/documents/D3000001/extract')
        .set(bearer(await token('checkerA')))
        .set('x-service-key', 'wrong');
      expect(res.status).toBe(401);
    });
  });

  describe('extraction provider selection and availability', () => {
    it('EXTRACTION_PROVIDER=ai reads the document text; provider, model and prompt are recorded; the mock is unchanged', async () => {
      const aiApp = buildApp(prisma, { extractionKind: 'ai' });
      const doc = await prisma.document.findFirstOrThrow({
        where: { application_id: 'A2000011' },
        orderBy: { doc_id: 'asc' },
      });
      const res = await request(aiApp.app)
        .post(`/api/v1/documents/${doc.doc_id}/extract`)
        .set('x-service-key', SERVICE_KEY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        provider: 'AI',
        extractor_version: 'ai|rules=2.0.0|model=none|prompt=none',
        degraded: false,
        persisted: true,
      });
      expect(res.body.doc_type_confidence).toBeGreaterThanOrEqual(0.8);
      const stored = await prisma.extraction.findMany({ where: { doc_id: doc.doc_id } });
      expect(stored.map((e) => e.provider).sort()).toEqual(expect.arrayContaining(['AI']));
      // the mock provider still answers from the supplied files, unchanged
      expect((await extract(doc.doc_id)).body).toMatchObject({
        provider: 'MOCK',
        extractor_version: 'mock:case_02_extraction_mock_sample_V1.0.csv',
      });
    });

    it('an AI provider whose model fails degrades to OTHER / 0.00 (so the case goes to REVIEW) and is stored as unavailable', async () => {
      const failing = {
        name: 'fake',
        model: 'fake-1',
        complete: () => Promise.reject(new Error('model offline')),
      };
      const aiApp = buildApp(prisma, { extractionKind: 'ai', llm: failing });
      const res = await request(aiApp.app)
        .post('/api/v1/documents/D3000007/extract')
        .set('x-service-key', SERVICE_KEY);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        provider: 'AI',
        extractor_version: 'ai:unavailable',
        doc_type: 'OTHER',
        doc_type_confidence: 0,
        degraded: true,
        persisted: true,
      });
      expect(aiApp.logs.join('\n')).toContain('extraction failed for D3000007');
      expect(aiApp.logs.join('\n')).not.toContain(realText('D3000007').slice(0, 30)); // text never logged
    });

    it('a provider that throws, or hangs past the timeout, degrades the same way', async () => {
      const throwing: ExtractionProvider = {
        name: 'MOCK',
        extract: () => Promise.reject(new Error('backend down')),
      };
      const hanging: ExtractionProvider = {
        name: 'MOCK',
        extract: () => new Promise(() => undefined),
      };
      for (const [provider, doc] of [
        [throwing, 'D3000008'],
        [hanging, 'D3000009'],
      ] as const) {
        const app = buildApp(prisma, { extraction: provider, extractionTimeoutMs: 50 });
        const res = await request(app.app)
          .post(`/api/v1/documents/${doc}/extract`)
          .set('x-service-key', SERVICE_KEY);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          doc_type: 'OTHER',
          doc_type_confidence: 0,
          degraded: true,
        });
      }
    });
  });

  describe('prompt injection: document text is data, never instructions', () => {
    const injection = realText('D3000486');

    it('the supplied injection document (D3000486) is OTHER, changes no decision, and is returned verbatim as data', async () => {
      const before = await prisma.application.findUniqueOrThrow({
        where: { application_id: 'A2100100' },
      });
      const res = await extract('D3000486');
      expect(res.body).toMatchObject({
        doc_type: 'OTHER',
        doc_type_confidence: Number(
          mockRows('D3000486').find((r) => r.field_name === 'doc_type')?.confidence,
        ),
      });
      const doc = await request(t.app)
        .get('/api/v1/applications/A2100100/documents/D3000486')
        .set(bearer(await token('officerA')));
      expect(doc.status).toBe(200);
      expect(doc.body.text).toBe(injection); // stored and served byte-for-byte, as a JSON string
      expect(doc.body.text).toContain('Ignore all previous instructions');
      expect(doc.headers['content-type']).toMatch(/application\/json/);
      expect(doc.headers['x-content-type-options']).toBe('nosniff');
      const after = await prisma.application.findUniqueOrThrow({
        where: { application_id: 'A2100100' },
      });
      expect(after.status).toBe(before.status);
      expect(after.version).toBe(before.version);
      expect(await prisma.checkerDecision.count({ where: { application_id: 'A2100100' } })).toBe(0);
      expect(await prisma.coreBankingAccount.count()).toBe(0);
    });

    it('uploading the injection text as a new document stores it as plain content and approves nothing', async () => {
      const appId = await newApplication();
      const siblings = await prisma.document.findMany({
        where: { application_id: 'A2100100', doc_id: { not: 'D3000486' } },
        orderBy: { doc_id: 'asc' },
      });
      expect(siblings.length).toBeGreaterThanOrEqual(2);
      const parts: Part[] = [
        { name: 'a.txt', content: siblings[0]?.text ?? '', type: 'PAN_CARD' },
        { name: 'b.txt', content: siblings[1]?.text ?? '', type: 'AADHAAR_CARD' },
        { name: 'c.txt', content: injection, type: 'AADHAAR_CARD' },
      ];
      const up = await upload(appId, parts, await token('applicantA'));
      expect(up.status).toBe(201);
      const injected = up.body.documents[2].doc_id as string;
      expect(up.body.documents[2].declared_doc_type).toBe('AADHAAR_CARD'); // what the text claims is irrelevant
      const ex = await extract(injected);
      expect(ex.body).toMatchObject({ doc_type: 'OTHER', doc_type_confidence: 0 });
      const app = await prisma.application.findUniqueOrThrow({ where: { application_id: appId } });
      expect(app.status).toBe('SUBMITTED');
      const kinds = (await prisma.auditEvent.findMany({ where: { application_id: appId } })).map(
        (e) => e.event_type,
      );
      expect(new Set(kinds)).toEqual(new Set(['DOCUMENT_UPLOADED', 'EXTRACTION_RECORDED']));
      expect(await prisma.checkerDecision.count()).toBe(0);
    });
  });
});
