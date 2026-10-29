import { COLUMNS, type DatasetName } from './manifest.js';
import { readCsv } from './read.js';
import { applicationRow, expectedRow } from './rows.js';
import { makeStep, requireKnown, type Step, type Tx } from './step.js';
import { planAgainst, validateRows, type Existing } from './validate.js';

export interface ApplicationsPlan {
  steps: Step[];
  knownApplications: Map<string, DatasetName>; // valid ids of this run + same-dataset ids in the DB
}

export async function planApplications(
  tx: Tx,
  dir: string,
  file: string,
  dataset: DatasetName,
): Promise<ApplicationsPlan> {
  const src = readCsv(dir, file, COLUMNS.applications, COLUMNS.applicationsExpected);

  // The expected_* columns come as a set of five (sample) or not at all (evaluation).
  const expectedCols = COLUMNS.applicationsExpected.filter((c) => src.columns.includes(c));
  const hasExpected = expectedCols.length === COLUMNS.applicationsExpected.length;
  if (expectedCols.length > 0 && !hasExpected) {
    const missing = COLUMNS.applicationsExpected.filter((c) => !src.columns.includes(c));
    src.rejections.push({
      file,
      line: 1,
      reason: `incomplete expected_* columns, missing: ${missing.join(', ')}`,
    });
  }

  const schema = hasExpected ? applicationRow.extend(expectedRow.shape) : applicationRow;
  const valid = validateRows(src, schema, (r) => r.application_id);

  const occupations = new Set(
    (await tx.occupation.findMany({ select: { occupation_code: true } })).map(
      (o) => o.occupation_code,
    ),
  );
  const fk = requireKnown(
    file,
    valid.rows,
    (r) => r.data.occupation_code,
    (code) =>
      occupations.has(code)
        ? true
        : `occupation_code ${code} does not exist (import reference data first)`,
    'occupation_code',
  );

  const existingRows = await tx.application.findMany({
    where: { application_id: { in: fk.kept.map((r) => r.key) } },
    select: { application_id: true, source_row_hash: true, dataset: true },
  });
  const existing = new Map<string, Existing>(
    existingRows.map((e) => [e.application_id, { hash: e.source_row_hash, dataset: e.dataset }]),
  );
  const plan = planAgainst(file, fk.kept, existing, dataset);
  const rejections = [...valid.rejections, ...fk.rejections, ...plan.rejections];

  const known = new Map<string, DatasetName>(fk.kept.map((r) => [r.key, dataset]));
  for (const e of await tx.application.findMany({
    where: { dataset },
    select: { application_id: true },
  }))
    known.set(e.application_id, dataset);

  const toInsert = plan.insert.map((r) => {
    const d = r.data as typeof r.data &
      Partial<Record<(typeof COLUMNS.applicationsExpected)[number], string>>;
    return { row: r, expected: hasExpected ? d : null };
  });

  const applications = makeStep(
    'applications',
    src,
    { inserted: plan.insert.length, skipped: plan.skipped, rejections },
    async (w) => {
      await w.application.createMany({
        data: toInsert.map(({ row }) => ({
          application_id: row.data.application_id,
          dataset,
          application_date: row.data.application_date,
          full_name: row.data.full_name,
          dob: row.data.dob,
          gender: row.data.gender,
          pan_number: row.data.pan_number,
          aadhaar_last4: row.data.aadhaar_last4,
          mobile: row.data.mobile,
          email: row.data.email,
          address: row.data.address,
          city: row.data.city,
          state: row.data.state,
          pincode: row.data.pincode,
          occupation_code: row.data.occupation_code,
          annual_income: row.data.annual_income,
          source_row_hash: row.hash,
        })),
      });
    },
  );

  const withExpected = toInsert.filter((t) => t.expected);
  const expected = makeStep(
    'application_expected',
    { ...src, dataRows: hasExpected ? src.dataRows : 0, rejections: [], warnings: [] },
    { inserted: withExpected.length, skipped: hasExpected ? plan.skipped : 0, rejections: [] },
    async (w) => {
      await w.applicationExpected.createMany({
        data: withExpected.map(({ row, expected: e }) => ({
          application_id: row.data.application_id,
          expected_decision: e?.expected_decision ?? '',
          expected_reason_codes: e?.expected_reason_codes ?? '',
          expected_name_match_score: e?.expected_name_match_score ?? '',
          expected_risk_category: e?.expected_risk_category ?? '',
          expected_rekyc_due_date: e?.expected_rekyc_due_date ?? '',
        })),
      });
    },
  );
  expected.sources = []; // same file as applications, recorded once
  return { steps: [applications, expected], knownApplications: known };
}
