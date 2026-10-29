// The output pipeline: database (or files) -> five deliverables + the sample check.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { aiExtractorVersion } from '../modules/extraction/ai/ai-provider.js';
import { normaliseForCompare } from '../modules/extraction/ai/evaluation.js';
import { FIELDS_BY_TYPE } from '../modules/extraction/ai/validators.js';
import { RULES_VERSION } from '../modules/workflow/evaluation.service.js';
import { datasetFiles, REFERENCE_FILES } from '../import/manifest.js';
import { loadDatasetFromDb, loadDatasetFromFiles, type Dataset } from './dataset.js';
import {
  aiDecisions,
  aiExtraction,
  decisionsCsv,
  extractionCsv,
  measureVariants,
  mockDecisions,
  type DecisionRow,
} from './build.js';
import { renderModelCard, renderReport, type Evidence, type Mismatch } from './report.js';
import { METRICS_FILE, OUTPUT_FILES, SAMPLE_FILES } from './spec.js';

export interface GeneratedFile {
  file: string;
  sha256: string;
  bytes: number;
}

export interface GenerationSummary {
  source: 'database' | 'files';
  files: GeneratedFile[];
  rows: { decisions: number; extraction: number; aiDecisions: number };
  sampleMockMismatches: Mismatch[];
  databaseVsFilesIdentical: boolean | null;
}

const EXPECTED_COLUMN: Record<string, string> = {
  decision: 'expected_decision',
  reason_codes: 'expected_reason_codes',
  name_match_score: 'expected_name_match_score',
  risk_category: 'expected_risk_category',
  rekyc_due_date: 'expected_rekyc_due_date',
};

export function compareToExpected(
  rows: DecisionRow[],
  expected: Map<string, Record<string, string>>,
): { checked: number; mismatches: Mismatch[]; differing: string[] } {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  for (const row of rows) {
    const want = expected.get(row.application_id);
    if (!want) continue;
    checked++;
    for (const [column, expectedColumn] of Object.entries(EXPECTED_COLUMN)) {
      const actual = row[column as keyof DecisionRow];
      if (actual !== (want[expectedColumn] ?? ''))
        mismatches.push({
          applicationId: row.application_id,
          column,
          expected: want[expectedColumn] ?? '',
          actual,
        });
    }
  }
  return { checked, mismatches, differing: [...new Set(mismatches.map((m) => m.applicationId))] };
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const countBy = (rows: DecisionRow[]): Record<string, number> =>
  rows.reduce<Record<string, number>>(
    (n, r) => ({ ...n, [r.decision]: (n[r.decision] ?? 0) + 1 }),
    {},
  );
const ratio = (correct: number, total: number) => ({
  correct,
  total,
  rate: total === 0 ? null : correct / total,
});

function inputFiles(dataDir: string): { file: string; sha256: string }[] {
  const names = [
    ...Object.values(REFERENCE_FILES),
    ...Object.values(datasetFiles('SAMPLE')).filter((f): f is string => f !== null),
    ...Object.values(datasetFiles('EVAL')).filter((f): f is string => f !== null),
  ].sort();
  return names.map((file) => ({ file, sha256: sha256(readFileSync(join(dataDir, file))) }));
}

export interface GenerateOptions {
  dataDir: string;
  outputDir: string;
  prisma?: PrismaClient;
}

function example9(
  sample: Dataset,
  ai: Awaited<ReturnType<typeof aiExtraction>>,
  rows: DecisionRow[],
): Evidence['sample']['example9'] {
  const row = rows.find((r) => r.application_id === 'A2000009');
  if (!row) return null;
  const docs = sample.documents
    .filter((d) => d.applicationId === 'A2000009')
    .map((d) => ai.perDocument.get(d.docId))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const pan = docs
    .find((d) => d.docType === 'PAN_CARD')
    ?.fields.find((f) => f.name === 'pan_number');
  const low = docs.flatMap((d) =>
    (FIELDS_BY_TYPE[d.docType as keyof typeof FIELDS_BY_TYPE] ?? []).flatMap((field) => {
      const f = d.fields.find((x) => x.name === field);
      return !f || f.confidence < 0.8
        ? [{ docType: d.docType, field, confidence: f?.confidence ?? 0 }]
        : [];
    }),
  );
  return {
    aiDecision: row.decision,
    aiReasonCodes: row.reason_codes === '' ? [] : row.reason_codes.split('|'),
    panValue: pan?.value ?? null,
    panConfidence: pan?.confidence ?? null,
    fieldsBelowThreshold: low,
  };
}

export async function generateOutputs({
  dataDir,
  outputDir,
  prisma,
}: GenerateOptions): Promise<GenerationSummary> {
  // The supplied input files are never written to: refuse an output folder that is, or is inside, the data folder.
  const rel = relative(resolve(dataDir), resolve(outputDir));
  if (rel === '' || !rel.startsWith('..'))
    throw new Error(`refusing to write outputs into the input folder ${dataDir}`);

  const sample = prisma
    ? await loadDatasetFromDb(prisma, 'SAMPLE')
    : loadDatasetFromFiles(dataDir, 'SAMPLE');
  const evalSet = prisma
    ? await loadDatasetFromDb(prisma, 'EVAL')
    : loadDatasetFromFiles(dataDir, 'EVAL');

  // 1. Mandatory output: mock extraction on the evaluation set.
  const mock = mockDecisions(evalSet);
  const decisions = decisionsCsv(mock.rows);

  // 2. The sample run is checked against the supplied expected columns.
  const sampleMock = mockDecisions(sample);
  const sampleCheck = compareToExpected(sampleMock.rows, sample.expected);

  // 3. AI track.
  const aiEval = await aiExtraction(evalSet);
  const extraction = extractionCsv(aiEval);
  const aiDec = aiDecisions(evalSet, aiEval);
  const aiDecCsv = decisionsCsv(aiDec.rows);
  const aiSample = await aiExtraction(sample);
  const aiSampleDecisions = aiDecisions(sample, aiSample);
  const aiSampleCheck = compareToExpected(aiSampleDecisions.rows, sample.expected);

  // 4. The database path must agree with the straight-from-files path.
  const fromFiles = prisma ? mockDecisions(loadDatasetFromFiles(dataDir, 'EVAL')) : null;
  const databaseVsFilesIdentical = fromFiles ? decisionsCsv(fromFiles.rows) === decisions : null;

  // 5. Evidence for the report.
  const variants = measureVariants(sample);
  const mockByDoc = new Map([...evalSet.mockDocuments.values()].flat().map((d) => [d.docId, d]));
  let typeAgree = 0;
  let fieldTotal = 0;
  let fieldAgree = 0;
  for (const d of evalSet.documents) {
    const m = mockByDoc.get(d.docId);
    const a = aiEval.perDocument.get(d.docId);
    if (!m || !a) continue;
    if (m.docType === a.docType) typeAgree++;
    for (const f of m.fields) {
      if (f.confidence < 0.8) continue;
      fieldTotal++;
      const got = a.fields.find((x) => x.name === f.name)?.value;
      if (
        got !== undefined &&
        normaliseForCompare(f.name, got) === normaliseForCompare(f.name, f.value)
      )
        fieldAgree++;
    }
  }
  const aiByApp = new Map(aiDec.rows.map((r) => [r.application_id, r]));
  const sameDecision = mock.rows.filter(
    (r) => aiByApp.get(r.application_id)?.decision === r.decision,
  ).length;
  const injectionDoc = evalSet.documents.find((d) =>
    /ignore all previous instructions/i.test(d.text),
  );
  const genders = [...new Set(evalSet.applications.map((a) => a.gender))].sort();
  const mockByApp = new Map(mock.rows.map((r) => [r.application_id, r]));

  const evidence: Evidence = {
    inputs: inputFiles(dataDir),
    extractorVersion: aiExtractorVersion(),
    rulesEngineVersion: RULES_VERSION,
    poorScanDefinition:
      'a document is a "poor scan" when its text lacks the exact line `SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT` (OCR damaged it). This definition is used only to split the report; the extractor does not use it.',
    sample: {
      documents: sample.documents.length,
      applications: sample.applications.length,
      declared: variants.declared,
      keywordRule: variants.keywordRule,
      regexOnly: variants.regexOnly,
      ai: variants.ai,
      mockVsExpected: { checked: sampleCheck.checked, mismatches: sampleCheck.mismatches },
      aiVsExpected: {
        checked: aiSampleCheck.checked,
        mismatches: aiSampleCheck.mismatches,
        applicationsDiffering: aiSampleCheck.differing,
      },
      example9: example9(sample, aiSample, aiSampleDecisions.rows),
    },
    evaluation: {
      applications: evalSet.applications.length,
      documents: evalSet.documents.length,
      mockDecisionCounts: countBy(mock.rows),
      aiDecisionCounts: countBy(aiDec.rows),
      aiVsMockDecisionAgreement: ratio(sameDecision, mock.rows.length),
      docTypeAgreementWithMock: ratio(typeAgree, evalSet.documents.length),
      fieldAgreementWithMock: ratio(fieldAgree, fieldTotal),
      injection: injectionDoc
        ? {
            docId: injectionDoc.docId,
            applicationId: injectionDoc.applicationId,
            aiDocType: aiEval.perDocument.get(injectionDoc.docId)?.docType ?? 'OTHER',
            aiWarnings: aiEval.warnings.get(injectionDoc.docId) ?? [],
            mockDocType: mockByDoc.get(injectionDoc.docId)?.docType ?? 'OTHER',
            keywordRuleDocType: (
              await import('../modules/extraction/ai/classifier.js')
            ).classifyByKeywordRule(injectionDoc.text),
            decisionWithAi: aiByApp.get(injectionDoc.applicationId)?.decision ?? '',
          }
        : null,
      nameMismatchMinorByGender: genders.map((g) => {
        const ids = evalSet.applications.filter((a) => a.gender === g).map((a) => a.applicationId);
        const has = (m: Map<string, DecisionRow>) =>
          ids.filter((id) => m.get(id)?.reason_codes.split('|').includes('NAME_MISMATCH_MINOR'))
            .length;
        return { gender: g, applications: ids.length, mock: has(mockByApp), ai: has(aiByApp) };
      }),
      lowConfidenceAiDocuments: [...aiEval.perDocument.values()].filter(
        (d) => d.docTypeConfidence < 0.8,
      ).length,
    },
    officerFeedback: prisma
      ? {
          aiFieldsExtracted: await prisma.extractedField.count({
            where: { extraction: { provider: 'AI' } },
          }),
          officerCorrections: await prisma.fieldCorrection.count(),
        }
      : { aiFieldsExtracted: null, officerCorrections: null },
    databaseVsFilesIdentical,
  };

  const outputs: [string, string][] = [
    [OUTPUT_FILES.decisions, decisions],
    [OUTPUT_FILES.extraction, extraction],
    [OUTPUT_FILES.aiDecisions, aiDecCsv],
    [OUTPUT_FILES.report, renderReport(evidence)],
    [OUTPUT_FILES.modelCard, renderModelCard(evidence)],
    [SAMPLE_FILES.decisions, decisionsCsv(sampleMock.rows)],
    [METRICS_FILE, JSON.stringify(evidence, null, 2) + '\n'],
  ];
  const files: GeneratedFile[] = [];
  for (const [file, text] of outputs) {
    const path = join(outputDir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
    files.push({ file, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  }
  return {
    source: sample.source,
    files,
    rows: {
      decisions: mock.rows.length,
      extraction: aiEval.csvRows.length,
      aiDecisions: aiDec.rows.length,
    },
    sampleMockMismatches: sampleCheck.mismatches,
    databaseVsFilesIdentical,
  };
}

export type { Dataset };
