// Builds the deliverable tables from a dataset. Pure and deterministic: the same dataset gives the same bytes.
import {
  createAiProvider,
  RULES_VERSION,
  aiExtractorVersion,
} from '../modules/extraction/ai/ai-provider.js';
import { classifyByKeywordRule } from '../modules/extraction/ai/classifier.js';
import {
  evaluateExtractor,
  isPoorScan,
  type DocSample,
  type Metrics,
} from '../modules/extraction/ai/evaluation.js';
import { extractWithRules } from '../modules/extraction/ai/rules-extractor.js';
import { FIELDS_BY_TYPE } from '../modules/extraction/ai/validators.js';
import { evaluate } from '../rules/evaluate.js';
import { formatScore } from '../rules/name.js';
import type { ClassifiedDocument, Evaluation } from '../rules/types.js';
import type { Dataset } from './dataset.js';
import { DECISION_HEADERS, EXTRACTION_HEADERS, csvText } from './spec.js';

export interface DecisionRow {
  application_id: string;
  decision: string;
  reason_codes: string;
  name_match_score: string;
  risk_category: string;
  rekyc_due_date: string;
}

export function toDecisionRow(applicationId: string, e: Evaluation): DecisionRow {
  return {
    application_id: applicationId,
    decision: e.decision,
    reason_codes: e.reasonCodes.join('|'),
    name_match_score: formatScore(e.nameMatchScore),
    risk_category: e.riskCategory ?? '',
    rekyc_due_date: e.rekycDueDate ?? '',
  };
}

export const decisionsCsv = (rows: DecisionRow[]): string =>
  csvText(
    DECISION_HEADERS,
    rows.map((r) => DECISION_HEADERS.map((h) => r[h as keyof DecisionRow])),
  );

function decideAll(
  ds: Dataset,
  documentsOf: (applicationId: string) => ClassifiedDocument[],
): { rows: DecisionRow[]; evaluations: Map<string, Evaluation> } {
  const evaluations = new Map<string, Evaluation>();
  const rows = ds.applications.map((a) => {
    const e = evaluate(
      a,
      documentsOf(a.applicationId),
      ds.reference.config,
      ds.reference.watchlists,
      ds.reference.existingCustomers,
    );
    evaluations.set(a.applicationId, e);
    return toDecisionRow(a.applicationId, e);
  });
  return { rows, evaluations };
}

/** Mandatory output: the engine fed by the supplied (mock) extraction. */
export const mockDecisions = (ds: Dataset) => decideAll(ds, (id) => ds.mockDocuments.get(id) ?? []);

export interface AiExtraction {
  perDocument: Map<string, ClassifiedDocument>;
  warnings: Map<string, string[]>;
  csvRows: string[][];
}

const FIELD_ORDER = [
  'name',
  'dob',
  'gender',
  'pan_number',
  'aadhaar_last4',
  'address',
  'pincode',
  'document_date',
  'valid_until',
];
const conf2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

/** The AI provider on every document of the dataset (text only; declared_doc_type is kept only for rule R2). */
export async function aiExtraction(ds: Dataset): Promise<AiExtraction> {
  const provider = createAiProvider();
  const perDocument = new Map<string, ClassifiedDocument>();
  const warnings = new Map<string, string[]>();
  const csvRows: string[][] = [];
  for (const d of ds.documents) {
    const out = await provider.extract({ docId: d.docId, text: d.text });
    perDocument.set(d.docId, {
      docId: d.docId,
      declaredDocType: d.declaredDocType,
      docType: out.docType,
      docTypeConfidence: Math.round(out.docTypeConfidence * 100) / 100,
      fields: out.fields.map((f) => ({ ...f, confidence: Math.round(f.confidence * 100) / 100 })),
    });
    warnings.set(d.docId, out.warnings ?? []);
    csvRows.push([d.docId, 'doc_type', out.docType, conf2(out.docTypeConfidence)]); // exactly one doc_type row per document
    const ordered = [...out.fields].sort(
      (a, b) => FIELD_ORDER.indexOf(a.name) - FIELD_ORDER.indexOf(b.name),
    );
    for (const f of ordered) csvRows.push([d.docId, f.name, f.value, conf2(f.confidence)]);
  }
  return { perDocument, warnings, csvRows };
}

export const extractionCsv = (ai: AiExtraction): string => csvText(EXTRACTION_HEADERS, ai.csvRows);

export function aiDecisions(ds: Dataset, ai: AiExtraction) {
  const byApp = new Map<string, ClassifiedDocument[]>();
  for (const d of ds.documents)
    byApp.set(d.applicationId, [
      ...(byApp.get(d.applicationId) ?? []),
      ai.perDocument.get(d.docId) as ClassifiedDocument,
    ]);
  return decideAll(ds, (id) => byApp.get(id) ?? []);
}

// ── Evidence for the report (sample only: the truth file exists only for the sample) ──
export interface VariantMetrics {
  label: string;
  metrics: Metrics;
}

export function sampleSamples(ds: Dataset): DocSample[] {
  return ds.documents.map((d) => ({
    docId: d.docId,
    applicationId: d.applicationId,
    text: d.text,
    truth: ds.truth.get(d.docId) ?? {},
    poor: isPoorScan(d.text),
  }));
}

export function measureVariants(ds: Dataset): {
  declared: Metrics;
  keywordRule: Metrics;
  regexOnly: VariantMetrics;
  ai: VariantMetrics;
} {
  const samples = sampleSamples(ds);
  const declaredByDoc = new Map(ds.documents.map((d) => [d.docId, d.declaredDocType]));
  const asPrediction = (version: '1.0.0' | '2.0.0') => (s: DocSample) => {
    const r = extractWithRules(s.text, version);
    return { docType: r.docType, docTypeConfidence: r.docTypeConfidence, fields: r.fields };
  };
  return {
    declared: evaluateExtractor(samples, (s) => ({
      docType: declaredByDoc.get(s.docId) ?? 'OTHER',
      docTypeConfidence: 1,
      fields: [],
    })),
    keywordRule: evaluateExtractor(samples, (s) => ({
      docType: classifyByKeywordRule(s.text),
      docTypeConfidence: 0.9,
      fields: [],
    })),
    regexOnly: {
      label: 'regex-only first version (rules 1.0.0)',
      metrics: evaluateExtractor(samples, asPrediction('1.0.0')),
    },
    ai: {
      label: `AI provider, deterministic rules ${RULES_VERSION} (${aiExtractorVersion()})`,
      metrics: evaluateExtractor(samples, asPrediction('2.0.0')),
    },
  };
}

export const FIELDS_FOR = FIELDS_BY_TYPE;
