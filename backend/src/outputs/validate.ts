// Validates the generated deliverables against their specification (sections 6.1, 6.3, 6.6) and against the
// supplied input files. It reads the files back from disk; it does not trust the generator's own tables.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { FIELDS_BY_TYPE, validateField, DOC_TYPES } from '../modules/extraction/ai/validators.js';
import { addYears } from '../rules/dates.js';
import { loadReference } from '../rules/file-data.js';
import { REASON_CODES } from '../rules/types.js';
import { datasetFiles } from '../import/manifest.js';
import { DECISION_HEADERS, EXTRACTION_HEADERS, OUTPUT_FILES, SAMPLE_FILES } from './spec.js';

// Codes of the rejecting rules R4-R10 (spec 6.1).
const REJECTING = new Set([
  'AGE_BELOW_18',
  'PAN_INVALID',
  'PAN_MISMATCH',
  'DOB_MISMATCH',
  'AADHAAR_MISMATCH',
  'NAME_MISMATCH',
  'SANCTIONS_MATCH',
]);

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const read = (path: string): string => readFileSync(path, 'utf8');
const isIso = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function parseCsv(path: string): { header: string[]; rows: string[][]; error?: string } {
  try {
    const all = parse(read(path), {
      relax_column_count: false,
      skip_empty_lines: true,
    }) as string[][];
    return { header: all[0] ?? [], rows: all.slice(1) };
  } catch (err) {
    return { header: [], rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function inputIds(dataDir: string, file: string, column: string): string[] {
  const rows = parse(read(join(dataDir, file)), {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  return rows.map((r) => r[column] as string);
}

/** Checks one decisions CSV (mock or AI) against the evaluation applications. */
function checkDecisions(label: string, path: string, dataDir: string, out: Check[]): void {
  const add = (name: string, ok: boolean, detail = ''): void => {
    out.push({ name: `${label}: ${name}`, ok, detail });
  };
  if (!existsSync(path)) {
    add('file exists', false, path);
    return;
  }
  const { header, rows, error } = parseCsv(path);
  add(
    'parses as CSV with a constant column count (no extra columns)',
    !error,
    error ?? `${rows.length} rows`,
  );
  add(
    'header and column order are exactly as specified',
    JSON.stringify(header) === JSON.stringify(DECISION_HEADERS),
    header.join(','),
  );

  const files = datasetFiles('EVAL');
  const apps = parse(read(join(dataDir, files.applications)), {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
  const ids = apps.map((a) => a.application_id as string);
  add(
    `one row per evaluation application (${ids.length})`,
    rows.length === ids.length,
    `found ${rows.length}`,
  );
  add(
    'application ids match the applications file, in order, no duplicates',
    JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(ids),
  );

  const reference = loadReference(dataDir);
  const dateOf = new Map(
    apps.map((a) => [a.application_id as string, a.application_date as string]),
  );
  const bad: string[] = [];
  for (const r of rows) {
    const [id, decision, codes, score, risk, rekyc] = r as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const list = codes === '' ? [] : codes.split('|');
    if (!['APPROVE', 'REVIEW', 'REJECT'].includes(decision))
      bad.push(`${id}: decision "${decision}"`);
    if (!list.every((c) => (REASON_CODES as readonly string[]).includes(c)))
      bad.push(`${id}: unknown reason code in "${codes}"`);
    const order = list.map((c) => REASON_CODES.indexOf(c as (typeof REASON_CODES)[number]));
    if (order.some((v, i) => i > 0 && v <= (order[i - 1] as number)))
      bad.push(`${id}: reason codes not in rule order`);
    if (score !== '' && !/^[01]\.\d{4}$/.test(score))
      bad.push(`${id}: score "${score}" is not 4 decimals`);
    if (risk !== '' && !['LOW', 'MEDIUM', 'HIGH'].includes(risk)) bad.push(`${id}: risk "${risk}"`);
    if (rekyc !== '' && !isIso(rekyc))
      bad.push(`${id}: re-KYC date "${rekyc}" is not a valid YYYY-MM-DD date`);
    // empty-cell conventions (spec 6.1): APPROVE has no codes; REJECT has no risk and no re-KYC date.
    if (decision === 'APPROVE' && codes !== '') bad.push(`${id}: APPROVE must have no reason code`);
    if (decision === 'REVIEW' && codes === '') bad.push(`${id}: REVIEW needs a reason code`);
    if (decision === 'REJECT' && (risk !== '' || rekyc !== ''))
      bad.push(`${id}: REJECT must leave risk and re-KYC empty`);
    if (decision === 'REJECT' && codes === '') bad.push(`${id}: REJECT needs a reason code`);
    if (decision !== 'REJECT' && (risk === '' || rekyc === ''))
      bad.push(`${id}: ${decision} needs risk and re-KYC date`);
    // independent recomputation of the re-KYC date from application_date and the configured period
    const date = dateOf.get(id);
    if (
      date &&
      rekyc !== '' &&
      risk !== '' &&
      rekyc !== addYears(date, reference.config.rekyc_years[risk as 'LOW' | 'MEDIUM' | 'HIGH'])
    )
      bad.push(`${id}: re-KYC date ${rekyc} is not application_date + the ${risk} period`);
    if (decision === 'REJECT' && !list.some((c) => REJECTING.has(c)))
      bad.push(`${id}: REJECT without any of R4-R10`);
    if (decision === 'REVIEW' && list.some((c) => REJECTING.has(c)))
      bad.push(`${id}: REVIEW carries a rejecting code`);
  }
  add(
    'values, dates, reason codes and empty-cell conventions are valid',
    bad.length === 0,
    bad.slice(0, 5).join('; '),
  );
}

export function validateOutputs(outputDir: string, dataDir: string): Check[] {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail = ''): void => {
    out.push({ name, ok, detail });
  };

  for (const file of Object.values(OUTPUT_FILES)) {
    const path = join(outputDir, file);
    add(`required file ${file} exists and is not empty`, existsSync(path) && read(path).length > 0);
  }

  checkDecisions(OUTPUT_FILES.decisions, join(outputDir, OUTPUT_FILES.decisions), dataDir, out);
  checkDecisions(OUTPUT_FILES.aiDecisions, join(outputDir, OUTPUT_FILES.aiDecisions), dataDir, out);

  // extraction_output.csv
  const label = OUTPUT_FILES.extraction;
  const addX = (name: string, ok: boolean, detail = '') =>
    out.push({ name: `${label}: ${name}`, ok, detail });
  const xPath = join(outputDir, label);
  if (existsSync(xPath)) {
    const { header, rows, error } = parseCsv(xPath);
    addX(
      'parses as CSV with 4 columns on every row (no extra columns)',
      !error,
      error ?? `${rows.length} rows`,
    );
    addX(
      'header and column order are exactly doc_id,field_name,value,confidence',
      JSON.stringify(header) === JSON.stringify(EXTRACTION_HEADERS),
      header.join(','),
    );
    const docIds = inputIds(dataDir, datasetFiles('EVAL').documents, 'doc_id');
    const typeRows = rows.filter((r) => r[1] === 'doc_type');
    addX(
      `exactly one doc_type row per evaluation document (${docIds.length})`,
      typeRows.length === docIds.length &&
        new Set(typeRows.map((r) => r[0])).size === docIds.length &&
        docIds.every((d) => typeRows.some((r) => r[0] === d)),
      `${typeRows.length} doc_type rows`,
    );
    addX(
      'no row refers to a document outside the evaluation set',
      rows.every((r) => docIds.includes(r[0] as string)),
    );
    const bad: string[] = [];
    const typeOf = new Map(typeRows.map((r) => [r[0] as string, r[2] as string]));
    const seen = new Set<string>();
    for (const r of rows) {
      const [docId, field, value, conf] = r as [string, string, string, string];
      if (!/^(0\.\d{2}|1\.00)$/.test(conf))
        bad.push(`${docId}/${field}: confidence "${conf}" is not 2 decimals in [0,1]`);
      if (value === '') bad.push(`${docId}/${field}: empty value`);
      if (seen.has(`${docId}|${field}`)) bad.push(`${docId}/${field}: duplicate row`);
      seen.add(`${docId}|${field}`);
      if (field === 'doc_type') {
        if (!(DOC_TYPES as readonly string[]).includes(value))
          bad.push(`${docId}: doc_type "${value}"`);
        continue;
      }
      const type = typeOf.get(docId) as keyof typeof FIELDS_BY_TYPE | undefined;
      if (!type || !FIELDS_BY_TYPE[type]?.includes(field))
        bad.push(`${docId}: field ${field} is not valid for ${type}`);
      else if (!validateField(field, value))
        bad.push(`${docId}/${field}: "${value}" is not a valid normalised value`);
    }
    addX(
      'every value is valid for its field (dates YYYY-MM-DD, PAN, pincode, last 4) and belongs to the document type',
      bad.length === 0,
      bad.slice(0, 5).join('; '),
    );
    addX(
      "each doc_type row comes before that document's field rows",
      rows.every(
        (r, i) =>
          r[1] === 'doc_type' || rows.slice(0, i).some((p) => p[0] === r[0] && p[1] === 'doc_type'),
      ),
    );
  }

  // markdown deliverables
  const report = existsSync(join(outputDir, OUTPUT_FILES.report))
    ? read(join(outputDir, OUTPUT_FILES.report))
    : '';
  for (const heading of [
    'AI-1 document classification',
    'AI-2 field extraction',
    'AI-4 confidence calibration',
    'Evaluation set (no labels)',
    'Limitations',
  ])
    add(`${OUTPUT_FILES.report} contains section "${heading}"`, report.includes(heading));
  add(
    `${OUTPUT_FILES.report} states that the evaluation set has no labels and claims no accuracy for it`,
    /no truth and no expected decisions/.test(report),
  );
  const card = existsSync(join(outputDir, OUTPUT_FILES.modelCard))
    ? read(join(outputDir, OUTPUT_FILES.modelCard))
    : '';
  for (const heading of ['Purpose', 'Responsible AI', 'Limitations'])
    add(`${OUTPUT_FILES.modelCard} contains section "${heading}"`, card.includes(heading));
  add(
    'no generated file contains a timestamp (so output is repeatable)',
    ![report, card].some((t) => /\b20\d\d-\d\d-\d\dT\d\d:\d\d/.test(t)),
  );

  // the sample run against the supplied expected columns
  const samplePath = join(outputDir, SAMPLE_FILES.decisions);
  if (existsSync(samplePath)) {
    const { rows } = parseCsv(samplePath);
    const expected = parse(read(join(dataDir, datasetFiles('SAMPLE').applications)), {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    const diff = expected.filter((e, i) => {
      const r = rows[i];
      return (
        !r ||
        r[0] !== e.application_id ||
        r[1] !== e.expected_decision ||
        r[2] !== e.expected_reason_codes ||
        r[3] !== e.expected_name_match_score ||
        r[4] !== e.expected_risk_category ||
        r[5] !== e.expected_rekyc_due_date
      );
    });
    add(
      `sample mock output reproduces all ${expected.length} expected_* rows (${SAMPLE_FILES.decisions})`,
      rows.length === expected.length && diff.length === 0,
      diff
        .slice(0, 5)
        .map((e) => e.application_id)
        .join(', '),
    );
  } else add(`sample output ${SAMPLE_FILES.decisions} exists`, false);
  return out;
}
