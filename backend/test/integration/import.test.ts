import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma } from '../../src/db/prisma.js';
import { runImport, type ImportResult, type ImportTarget } from '../../src/import/run.js';
import { makeDataDir, REAL_DATA_DIR, removeDir } from '../support/data-dir.js';
import { truncateAll } from '../support/db.js';

const url = process.env.TEST_DATABASE_URL;
const dbTest = url ? describe : describe.skip;

dbTest('importer (PostgreSQL test database)', () => {
  let prisma: PrismaClient;
  const dirs: string[] = [];

  beforeAll(() => {
    prisma = createPrisma(url as string);
  });
  afterAll(async () => {
    dirs.forEach(removeDir);
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const imp = (target: ImportTarget, dir = REAL_DATA_DIR): Promise<ImportResult> =>
    runImport(prisma, target, { dataDir: dir });
  const damaged = (mutate: Parameters<typeof makeDataDir>[0]): string => {
    const dir = makeDataDir(mutate);
    dirs.push(dir);
    return dir;
  };
  const rowCounts = async () => ({
    applications: await prisma.application.count(),
    documents: await prisma.document.count(),
    extractions: await prisma.extraction.count(),
    fields: await prisma.extractedField.count(),
  });
  const count = (r: ImportResult, table: string) => r.tables.find((t) => t.table === table);

  describe('clean import', () => {
    it('imports the whole data pack with the expected row counts', async () => {
      const ref = await imp('REFERENCE');
      const sample = await imp('SAMPLE');
      const evalSet = await imp('EVAL');
      for (const r of [ref, sample, evalSet]) {
        expect(r.rejections).toEqual([]);
        expect(r.committed).toBe(true);
      }
      expect(ref.tables.map((t) => [t.table, t.inserted])).toEqual([
        ['rule_config', 1],
        ['occupations', 12],
        ['sanctions_list', 50],
        ['pep_list', 60],
        ['existing_customers', 300],
      ]);
      expect(sample.tables.map((t) => [t.table, t.inserted])).toEqual([
        ['applications', 60],
        ['application_expected', 60],
        ['documents', 178],
        ['extracted_fields', 946],
        ['document_truth', 178],
      ]);
      expect(evalSet.tables.map((t) => [t.table, t.inserted])).toEqual([
        ['applications', 100],
        ['application_expected', 0],
        ['documents', 296],
        ['extracted_fields', 1583],
      ]);
      expect(await prisma.extraction.count()).toBe(474); // one per document
    });

    it('keeps sample and evaluation data separate', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      await imp('EVAL');
      expect(await prisma.application.count({ where: { dataset: 'SAMPLE' } })).toBe(60);
      expect(await prisma.application.count({ where: { dataset: 'EVAL' } })).toBe(100);
      expect(await prisma.document.count({ where: { dataset: 'EVAL' } })).toBe(296);
      // expected_* and truth exist for the sample only
      expect(
        await prisma.applicationExpected.count({ where: { application: { dataset: 'EVAL' } } }),
      ).toBe(0);
      expect(await prisma.documentTruth.count({ where: { document: { dataset: 'EVAL' } } })).toBe(
        0,
      );
    });

    it('preserves source values exactly (leading zeros, raw misreads, source columns)', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      const a = await prisma.application.findUniqueOrThrow({
        where: { application_id: 'A2000001' },
      });
      expect(a).toMatchObject({
        full_name: 'Ravi Kumar Sharma',
        pan_number: 'ZZKPS1234Q',
        aadhaar_last4: '4821',
        annual_income: 900000,
      });
      expect(
        await prisma.application.count({ where: { aadhaar_last4: { startsWith: '0' } } }),
      ).toBeGreaterThan(0);
      const misread = await prisma.extractedField.findFirstOrThrow({
        where: { doc_id: 'D3000025', field_name: 'pan_number' },
      });
      expect(misread.value).toBe('ZZTP59O12Y'); // worked example 9, kept as read
      expect(Number(misread.confidence)).toBe(0.62);
      const expected = await prisma.applicationExpected.findUniqueOrThrow({
        where: { application_id: 'A2000004' },
      });
      expect(expected).toMatchObject({
        expected_decision: 'REVIEW',
        expected_name_match_score: '0.7647',
      });
    });

    it('stores the rule configuration and watchlists from the files, not from code', async () => {
      await imp('REFERENCE');
      const config = await prisma.ruleConfig.findFirstOrThrow({ where: { is_active: true } });
      const file = JSON.parse(
        readFileSync(join(REAL_DATA_DIR, 'case_02_rules_config_V1.0.json'), 'utf8'),
      ) as unknown;
      expect(config.config).toEqual(file);
      expect(
        await prisma.sanctionsEntry.findUniqueOrThrow({ where: { list_id: 'SAN0002' } }),
      ).toMatchObject({ name: 'Valko Quillon' });
      expect((await prisma.pepEntry.findUniqueOrThrow({ where: { pep_id: 'PEP0001' } })).name).toBe(
        'Zoya Menon',
      );
    });

    it('stores the SHA-256 of each document text', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      const docs = await prisma.document.findMany();
      expect(docs).toHaveLength(178);
      for (const d of docs)
        expect(d.sha256).toBe(createHash('sha256').update(d.text, 'utf8').digest('hex'));
    });

    it('never modifies the original input files', async () => {
      const snapshot = () =>
        readdirSync(REAL_DATA_DIR)
          .sort()
          .map(
            (f) =>
              `${f}:${createHash('sha256')
                .update(readFileSync(join(REAL_DATA_DIR, f)))
                .digest('hex')}`,
          );
      const before = snapshot();
      await imp('REFERENCE');
      await imp('SAMPLE');
      expect(snapshot()).toEqual(before);
    });
  });

  describe('re-import', () => {
    it('skips everything and changes nothing when the same files are imported again', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      await imp('EVAL');
      const before = await rowCounts();
      for (const target of ['REFERENCE', 'SAMPLE', 'EVAL'] as const) {
        const again = await imp(target);
        expect(again.committed).toBe(true);
        expect(again.tables.every((t) => t.inserted === 0 && t.rejected === 0)).toBe(true);
      }
      expect(count(await imp('SAMPLE'), 'documents')).toMatchObject({ inserted: 0, skipped: 178 });
      expect(await rowCounts()).toEqual(before);
    });

    it('adds only the missing rows after a partial earlier import', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      await prisma.extractedField.deleteMany({ where: { doc_id: 'D3000001' } });
      const again = await imp('SAMPLE');
      expect(count(again, 'extracted_fields')).toMatchObject({ inserted: 4, skipped: 942 });
      expect(await prisma.extractedField.count({ where: { doc_id: 'D3000001' } })).toBe(4);
    });
  });

  describe('duplicates', () => {
    it('rejects a repeated application_id within a file and writes nothing', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_applications_sample_V1.0.csv', (t) => {
          const lines = t.split('\r\n');
          return `${t.trimEnd()}\r\n${lines[1]}\r\n`;
        }),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections).toEqual([
        expect.objectContaining({
          line: 62,
          reason: expect.stringContaining('duplicate key A2000001 (first seen at line 2)'),
        }),
      ]);
      expect((await rowCounts()).applications).toBe(0);
    });

    it('rejects an existing identifier arriving with different content instead of overwriting it', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      const dir = damaged((e) =>
        e.edit('case_02_applications_sample_V1.0.csv', (t) =>
          t.replace('A2000001,2026-03-04,Ravi Kumar Sharma', 'A2000001,2026-03-04,Ravi K Sharma'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections[0]?.reason).toContain('A2000001 already imported with different content');
      expect(
        (await prisma.application.findUniqueOrThrow({ where: { application_id: 'A2000001' } }))
          .full_name,
      ).toBe('Ravi Kumar Sharma');
    });

    it('rejects the same file content twice for one application (SHA-256 idempotency)', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) => {
        const pan = (
          JSON.parse(
            readFileSync(
              join(REAL_DATA_DIR, 'case_02_document_text_sample_V1.0.jsonl'),
              'utf8',
            ).split('\n')[0] as string,
          ) as { text: string }
        ).text;
        e.editJsonl('case_02_document_text_sample_V1.0.jsonl', (row) =>
          row.doc_id === 'D3000002' ? { ...row, text: pan } : row,
        );
      });
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason)).toContain(
        'same content as D3000001 for application A2000001',
      );
      expect((await rowCounts()).documents).toBe(0);
    });

    it('rejects a sample identifier that reappears in the evaluation set', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      const dir = damaged((e) =>
        e.edit('case_02_applications_eval_V1.0.csv', (t) => t.replace('A2100001,', 'A2000001,')),
      );
      const r = await imp('EVAL', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason).join('\n')).toContain(
        'A2000001 already exists in dataset SAMPLE',
      );
      expect(await prisma.application.count({ where: { dataset: 'EVAL' } })).toBe(0);
    });
  });

  describe('malformed input', () => {
    it('reports every bad row with its line number and writes nothing', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit(
          'case_02_applications_sample_V1.0.csv',
          (t) =>
            t
              .replace(/^A2000002,.*$/m, 'A2000002,2026-03-04,Kavya') // too few columns
              .replace('A2000003,2026-03-04', 'A2000003,2026-02-30') // impossible date
              .replace('ZZKPS1234Q,4821,', 'ZZKPS1234Q,482112345678,'), // full Aadhaar, must be refused
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      // Other files may also flag a dependent row on the same line number, so key by file too.
      const apps = r.rejections.filter((x) => x.file === 'case_02_applications_sample_V1.0.csv');
      const byLine = Object.fromEntries(apps.map((x) => [x.line, x.reason]));
      expect(apps).toHaveLength(3);
      expect(byLine[3]).toContain('expected 20 values, found 3');
      expect(byLine[4]).toContain('is not a real calendar date');
      expect(byLine[2]).toContain('must be exactly 4 digits');
      expect((await rowCounts()).applications).toBe(0);
    });

    it('rejects invalid JSON lines in the document text file', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_document_text_sample_V1.0.jsonl', (t) =>
          t
            .replace('{"doc_id": "D3000003"', '{"doc_id" "D3000003"')
            .replace('{"doc_id":"D3000003"', '{"doc_id" "D3000003"'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason)).toContain('invalid JSON');
    });

    it('rejects a confidence outside 0 to 1', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_extraction_mock_sample_V1.0.csv', (t) =>
          t.replace('D3000001,doc_type,PAN_CARD,0.97', 'D3000001,doc_type,PAN_CARD,1.7'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.rejections[0]).toMatchObject({
        line: 2,
        reason: expect.stringContaining('confidence must be a number from 0 to 1'),
      });
    });
  });

  describe('missing files and columns', () => {
    it('rejects a file with a missing required column', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_applications_sample_V1.0.csv', (t) =>
          t.replace('application_date,full_name,dob,gender', 'application_date,full_name,gender'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason)).toContain('missing required column(s): dob');
      expect((await rowCounts()).applications).toBe(0);
    });

    it('reports a missing file explicitly', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) => e.remove('case_02_extraction_mock_sample_V1.0.csv'));
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections).toContainEqual({
        file: 'case_02_extraction_mock_sample_V1.0.csv',
        line: null,
        reason: 'file not found',
      });
    });

    it('rejects a rule configuration that lacks a required key', async () => {
      const dir = damaged((e) =>
        e.edit('case_02_rules_config_V1.0.json', (t) => t.replace('"min_age": 18,', '')),
      );
      const r = await imp('REFERENCE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections[0]?.reason).toContain('min_age');
      expect(await prisma.ruleConfig.count()).toBe(0);
    });
  });

  describe('invalid foreign keys', () => {
    it('rejects applications whose occupation_code does not exist', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_applications_sample_V1.0.csv', (t) =>
          t.replace('400001,SALARIED_PRIVATE,900000,APPROVE', '400001,NO_SUCH_JOB,900000,APPROVE'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections[0]).toMatchObject({
        line: 2,
        reason: 'occupation_code NO_SUCH_JOB does not exist (import reference data first)',
      });
    });

    it('rejects a document that points at an unknown application', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_documents_sample_V1.0.csv', (t) =>
          t.replace('D3000001,A2000001,', 'D3000001,A9999999,'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason)).toContain('application_id A9999999 does not exist');
    });

    it('rejects extraction rows for an unknown document', async () => {
      await imp('REFERENCE');
      const dir = damaged((e) =>
        e.edit('case_02_extraction_mock_sample_V1.0.csv', (t) =>
          t.replace('D3000001,doc_type,', 'D9999999,doc_type,'),
        ),
      );
      const r = await imp('SAMPLE', dir);
      expect(r.committed).toBe(false);
      expect(r.rejections.map((x) => x.reason)).toContain(
        'doc_id D9999999 is not a document of this dataset',
      );
    });

    it('rejects a dataset imported before the reference data', async () => {
      const r = await imp('SAMPLE');
      expect(r.committed).toBe(false);
      expect(r.rejections.length).toBeGreaterThanOrEqual(60);
      expect(r.rejections[0]?.reason).toContain('import reference data first');
    });
  });

  describe('transactions', () => {
    it('rolls everything back when the import fails after writing', async () => {
      await imp('REFERENCE');
      const runsBefore = await prisma.importRun.count();
      await expect(
        runImport(prisma, 'SAMPLE', {
          dataDir: REAL_DATA_DIR,
          beforeCommit: () => Promise.reject(new Error('simulated crash before commit')),
        }),
      ).rejects.toThrow('simulated crash before commit');
      expect(await rowCounts()).toEqual({
        applications: 0,
        documents: 0,
        extractions: 0,
        fields: 0,
      });
      expect(await prisma.applicationExpected.count()).toBe(0);
      expect(await prisma.documentTruth.count()).toBe(0);
      expect(await prisma.importRun.count()).toBe(runsBefore);
      // and a normal import afterwards succeeds
      expect((await imp('SAMPLE')).committed).toBe(true);
    });
  });

  describe('database guards', () => {
    it('blocks UPDATE and DELETE on audit_events', async () => {
      await prisma.auditEvent.create({
        data: { event_type: 'STATUS_CHANGED', actor_role: 'SYSTEM' },
      });
      await expect(prisma.$executeRaw`UPDATE audit_events SET actor_role = 'X'`).rejects.toThrow(
        /append-only/,
      );
      await expect(prisma.$executeRaw`DELETE FROM audit_events`).rejects.toThrow(/append-only/);
      expect(await prisma.auditEvent.count()).toBe(1);
    });

    it('refuses a stored Aadhaar that is not exactly 4 digits', async () => {
      await imp('REFERENCE');
      await imp('SAMPLE');
      await expect(
        prisma.$executeRaw`UPDATE applications SET aadhaar_last4 = 'abcd'`,
      ).rejects.toThrow(/aadhaar_last4/);
    });
  });
});
