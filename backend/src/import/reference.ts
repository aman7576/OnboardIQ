// Reference data: rule configuration, occupations, watchlists, existing customers.
import { COLUMNS, REFERENCE_FILES as F } from './manifest.js';
import { readCsv, readJson, type SourceFile } from './read.js';
import { existingCustomerRow, occupationRow, pepRow, rulesConfig, sanctionsRow } from './rows.js';
import { makeStep, type Step, type Tx } from './step.js';
import { planAgainst, validateRows, type Existing } from './validate.js';

const byKey = <T>(rows: T[], key: (r: T) => string, hash: (r: T) => string | null) =>
  new Map<string, Existing>(rows.map((r) => [key(r), { hash: hash(r) }]));

async function rulesConfigStep(tx: Tx, dir: string): Promise<Step> {
  const read = readJson(dir, F.rulesConfig);
  const src: SourceFile = {
    file: F.rulesConfig,
    sha256: 'sha256' in read ? read.sha256 : '',
    rows: [],
    rejections: 'reason' in read ? [read] : [],
    warnings: [],
    columns: [],
    dataRows: 1,
  };
  if ('reason' in read)
    return makeStep(
      'rule_config',
      src,
      { inserted: 0, skipped: 0, rejections: [read] },
      async () => {},
    );

  const parsed = rulesConfig.safeParse(read.value);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
    return makeStep(
      'rule_config',
      src,
      { inserted: 0, skipped: 0, rejections: [{ file: src.file, line: null, reason }] },
      async () => {},
    );
  }
  const already = await tx.ruleConfig.findUnique({ where: { source_sha256: read.sha256 } });
  if (already)
    return makeStep(
      'rule_config',
      src,
      { inserted: 0, skipped: 1, rejections: [] },
      async () => {},
    );

  return makeStep('rule_config', src, { inserted: 1, skipped: 0, rejections: [] }, async (w) => {
    // A newly supplied file becomes the active configuration (one active row, see migration).
    await w.ruleConfig.updateMany({ where: { is_active: true }, data: { is_active: false } });
    await w.ruleConfig.create({
      data: {
        version: parsed.data.version,
        config: read.value as object,
        source_file: F.rulesConfig,
        source_sha256: read.sha256,
        is_active: true,
      },
    });
  });
}

async function occupationsStep(tx: Tx, dir: string): Promise<Step> {
  const src = readCsv(dir, F.occupations, COLUMNS.occupations);
  const { rows, rejections } = validateRows(src, occupationRow, (r) => r.occupation_code);
  const existing = await tx.occupation.findMany({
    select: { occupation_code: true, source_row_hash: true },
  });
  const plan = planAgainst(
    src.file,
    rows,
    byKey(
      existing,
      (e) => e.occupation_code,
      (e) => e.source_row_hash,
    ),
  );
  return makeStep(
    'occupations',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...rejections, ...plan.rejections],
    },
    async (w) => {
      await w.occupation.createMany({
        data: plan.insert.map((r) => ({ ...r.data, source_row_hash: r.hash })),
      });
    },
  );
}

async function sanctionsStep(tx: Tx, dir: string): Promise<Step> {
  const src = readCsv(dir, F.sanctions, COLUMNS.sanctions);
  const { rows, rejections } = validateRows(src, sanctionsRow, (r) => r.list_id);
  const existing = await tx.sanctionsEntry.findMany({
    select: { list_id: true, source_row_hash: true },
  });
  const plan = planAgainst(
    src.file,
    rows,
    byKey(
      existing,
      (e) => e.list_id,
      (e) => e.source_row_hash,
    ),
  );
  return makeStep(
    'sanctions_list',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...rejections, ...plan.rejections],
    },
    async (w) => {
      await w.sanctionsEntry.createMany({
        data: plan.insert.map((r) => ({ ...r.data, source_row_hash: r.hash })),
      });
    },
  );
}

async function pepStep(tx: Tx, dir: string): Promise<Step> {
  const src = readCsv(dir, F.pep, COLUMNS.pep);
  const { rows, rejections } = validateRows(src, pepRow, (r) => r.pep_id);
  const existing = await tx.pepEntry.findMany({ select: { pep_id: true, source_row_hash: true } });
  const plan = planAgainst(
    src.file,
    rows,
    byKey(
      existing,
      (e) => e.pep_id,
      (e) => e.source_row_hash,
    ),
  );
  return makeStep(
    'pep_list',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...rejections, ...plan.rejections],
    },
    async (w) => {
      await w.pepEntry.createMany({
        data: plan.insert.map((r) => ({ ...r.data, source_row_hash: r.hash })),
      });
    },
  );
}

async function existingCustomersStep(tx: Tx, dir: string): Promise<Step> {
  const src = readCsv(dir, F.existingCustomers, COLUMNS.existingCustomers);
  const { rows, rejections } = validateRows(src, existingCustomerRow, (r) => r.customer_id);
  const existing = await tx.existingCustomer.findMany({
    select: { customer_id: true, source_row_hash: true },
  });
  const plan = planAgainst(
    src.file,
    rows,
    byKey(
      existing,
      (e) => e.customer_id,
      (e) => e.source_row_hash,
    ),
  );
  return makeStep(
    'existing_customers',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...rejections, ...plan.rejections],
    },
    async (w) => {
      await w.existingCustomer.createMany({
        data: plan.insert.map((r) => ({ ...r.data, source_row_hash: r.hash })),
      });
    },
  );
}

/** Plans all reference tables in dependency order (no reference table depends on another). */
export async function planReference(tx: Tx, dir: string): Promise<Step[]> {
  return [
    await rulesConfigStep(tx, dir),
    await occupationsStep(tx, dir),
    await sanctionsStep(tx, dir),
    await pepStep(tx, dir),
    await existingCustomersStep(tx, dir),
  ];
}
