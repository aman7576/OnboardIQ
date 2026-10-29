// Reads the supplied data pack directly, so tests compare against the real files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PrismaClient } from '@prisma/client';
import { runImport } from '../../src/import/run.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { stableUuid } from '../../src/import/validate.js';
import { REAL_DATA_DIR } from './data-dir.js';
import { CHEAP_HASH, PASSWORD } from './world.js';

const file = (name: string) => readFileSync(join(REAL_DATA_DIR, name), 'utf8');

/** Document text exactly as supplied in the document_text_*.jsonl files. */
export function realText(docId: string): string {
  for (const f of [
    'case_02_document_text_sample_V1.0.jsonl',
    'case_02_document_text_eval_V1.0.jsonl',
  ]) {
    for (const line of file(f).split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { doc_id: string; text: string };
      if (row.doc_id === docId) return row.text;
    }
  }
  throw new Error(`no supplied text for ${docId}`);
}

export interface MockRow {
  doc_id: string;
  field_name: string;
  value: string;
  confidence: string;
}

/** Rows of the supplied extraction_mock files for one document, in file order. */
export function mockRows(docId: string): MockRow[] {
  return [
    'case_02_extraction_mock_sample_V1.0.csv',
    'case_02_extraction_mock_eval_V1.0.csv',
  ].flatMap((f) =>
    (parse(file(f), { columns: true, skip_empty_lines: true }) as MockRow[]).filter(
      (r) => r.doc_id === docId,
    ),
  );
}

export type Who = 'applicantA' | 'applicantB' | 'officerA' | 'officerB' | 'checkerA' | 'checkerB';

/** Imports the real data pack and adds one user per role needed by the document tests. */
export async function loadRealWorld(prisma: PrismaClient) {
  for (const target of ['REFERENCE', 'SAMPLE', 'EVAL'] as const) {
    const result = await runImport(prisma, target, { dataDir: REAL_DATA_DIR });
    if (!result.committed)
      throw new Error(`import ${target} failed: ${JSON.stringify(result.rejections[0])}`);
  }
  const password_hash = await hashPassword(PASSWORD, CHEAP_HASH);
  const users: Record<Who, { id: string; email: string }> = {} as never;
  for (const [key, role] of [
    ['applicantA', 'APPLICANT'],
    ['applicantB', 'APPLICANT'],
    ['officerA', 'KYC_OFFICER'],
    ['officerB', 'KYC_OFFICER'],
    ['checkerA', 'COMPLIANCE_OFFICER'],
    ['checkerB', 'COMPLIANCE_OFFICER'],
  ] as const) {
    const email = `${key.toLowerCase()}@test.local`;
    const user = await prisma.user.create({
      data: { id: stableUuid('real-user', key), email, display_name: key, role, password_hash },
    });
    users[key] = { id: user.id, email };
  }
  // A2000001: applicantA, SUBMITTED (PAN D3000001). A2100100 holds the prompt-injection document D3000486.
  await prisma.application.update({
    where: { application_id: 'A2000001' },
    data: { applicant_user_id: users.applicantA.id },
  });
  await prisma.application.update({
    where: { application_id: 'A2000002' },
    data: { applicant_user_id: users.applicantB.id },
  });
  await prisma.application.update({
    where: { application_id: 'A2000003' },
    data: { status: 'IN_REVIEW' },
  });
  await prisma.application.update({
    where: { application_id: 'A2100100' },
    data: { status: 'IN_REVIEW' },
  });
  return users;
}
