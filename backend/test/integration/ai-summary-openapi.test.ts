// AI-5 reviewer summary endpoint (with a fake LLM) and the OpenAPI contract (every documented route exists,
// none is undocumented).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPERATIONS } from '../../src/docs/openapi.js';
import type { LlmClient, LlmRequest } from '../../src/modules/extraction/ai/llm.js';
import { describeDb, testPrisma, truncateAll } from '../support/db.js';
import { bearer, buildApp, type TestApp } from '../support/http.js';
import { loadRealWorld, type Who } from '../support/real-data.js';
import { PASSWORD } from '../support/world.js';

describeDb('AI-5 reviewer summary and API contract', () => {
  let prisma: PrismaClient;
  let users: Awaited<ReturnType<typeof loadRealWorld>>;
  let plain: TestApp; // no LLM configured
  let withLlm: TestApp;
  let answer = '';
  const seen: LlmRequest[] = [];
  const llm: LlmClient = {
    name: 'fake',
    model: 'fake-1',
    complete: (r) => {
      seen.push(r);
      return Promise.resolve(answer);
    },
  };

  beforeAll(async () => {
    prisma = testPrisma();
    await truncateAll(prisma);
    users = await loadRealWorld(prisma);
    plain = buildApp(prisma);
    withLlm = buildApp(prisma, { summaryLlm: llm });
    for (const [id, owner] of [
      ['A2000009', 'applicantA'],
      ['A2000001', 'applicantA'],
    ] as const) {
      await prisma.application.update({
        where: { application_id: id },
        data: { applicant_user_id: users[owner].id },
      });
      const token = await plain.login(users[owner].email, PASSWORD);
      expect(
        (await request(plain.app).post(`/api/v1/applications/${id}/submit`).set(bearer(token)))
          .status,
      ).toBe(200);
    }
  }, 60_000);
  afterAll(() => prisma.$disconnect());

  const get = async (t: TestApp, who: Who, id: string) =>
    request(t.app)
      .get(`/api/v1/applications/${id}/ai-summary`)
      .set(bearer(await t.login(users[who].email, PASSWORD)));

  it('is off unless an LLM is configured (503), and never offered to applicants (403)', async () => {
    expect((await get(plain, 'officerA', 'A2000009')).status).toBe(503);
    expect((await get(withLlm, 'applicantA', 'A2000009')).status).toBe(403);
  });

  it('returns a labelled, validated summary for a REVIEW case; the model saw facts, never the document text', async () => {
    answer = JSON.stringify({
      summary:
        'R3 fired: pan_number on D3000025 was read as ZZTP59O12Y with confidence 0.62, below 0.8, so R6 was not evaluated.',
    });
    const res = await get(withLlm, 'officerA', 'A2000009');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      label: 'AI-generated',
      application_id: 'A2000009',
      model: 'fake/fake-1',
      prompt_version: 'review-summary-v1',
    });
    expect(res.body.words).toBeLessThanOrEqual(80);
    const last = seen.at(-1)!;
    expect(last.tool?.name).toBe('record_summary');
    expect(last.user).toContain('ZZTP59O12Y');
    expect(last.user).not.toMatch(/INCOME TAX DEPARTMENT|Permanent Account Number/i); // no OCR text
    expect(last.user).not.toMatch(/"decision"/);
  });

  it('withholds a summary that recommends a decision or invents a value (502), so nothing unsafe is shown', async () => {
    answer = JSON.stringify({ summary: 'The PAN is clearly ZZTPS9012Y; approve the case.' });
    const res = await get(withLlm, 'officerA', 'A2000009');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('AI_SUMMARY_WITHHELD');
  });

  it('is only for REVIEW cases (409), and respects officer scope (404 for an auto-approved case)', async () => {
    expect((await get(withLlm, 'checkerA', 'A2000001')).status).toBe(409);
    expect((await get(withLlm, 'officerA', 'A2000001')).status).toBe(404);
  });

  it('a failing LLM gives 503 without echoing anything', async () => {
    const broken = buildApp(prisma, {
      summaryLlm: {
        name: 'x',
        model: 'y',
        complete: () => Promise.reject(new Error('secret prompt here')),
      },
    });
    const res = await get(broken, 'officerA', 'A2000009');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  describe('OpenAPI contract', () => {
    it('serves a valid-looking OpenAPI 3.1 document and the Swagger UI page', async () => {
      const doc = await request(plain.app).get('/api/v1/openapi.json');
      expect(doc.status).toBe(200);
      expect(doc.body.openapi).toBe('3.1.0');
      expect(
        doc.body.paths['/api/v1/applications'].post.requestBody.content['application/json'].schema
          .required,
      ).toContain('aadhaar_last4');
      const ui = await request(plain.app).get('/api/docs');
      expect(ui.status).toBe(200);
      expect(ui.headers['content-security-policy']).toContain('cdn.jsdelivr.net');
    });

    it('every documented operation exists in the app (no "No route" 404)', async () => {
      for (const op of OPERATIONS) {
        const path = op.path.replace(/\{[^}]+\}/g, 'X1');
        const res = await request(plain.app)[op.method](path);
        expect(`${op.method} ${op.path}: ${res.body?.message ?? ''}`).not.toMatch(/No route for/);
      }
    });

    it('no route in the source is undocumented', () => {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (p.endsWith('.ts')) files.push(p);
        }
      };
      walk(join(import.meta.dirname, '../../src'));
      const declared = files.flatMap((f) =>
        [
          ...readFileSync(f, 'utf8').matchAll(
            /\b(?:router|app)\.(get|post|put|delete)\(\s*'([^']+)'/g,
          ),
        ].map((m) => `${m[1]} ${m[2]}`),
      );
      // The Swagger UI page itself is not an API operation. Each declared route segment must be the tail of a documented path (mount prefixes differ).
      const documented = OPERATIONS.map(
        (o) => `${o.method} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`,
      );
      const missing = declared
        .filter((d) => !d.includes('/api/docs'))
        .filter((d) => {
          const [m, p] = d.split(' ');
          return !documented.some(
            (x) =>
              x.startsWith(`${m} `) &&
              (x.endsWith(p!) || (p === '/' && x.split(' ')[1]!.split('/').length > 0)),
          );
        });
      expect(missing).toEqual([]);
      expect(declared.length).toBeGreaterThanOrEqual(OPERATIONS.length - 4);
    });
  });
});
