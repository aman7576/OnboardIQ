// Mock extraction output (long format) and the sample truth file.
import { COLUMNS } from './manifest.js';
import { readCsv } from './read.js';
import { extractionRow, truthRow } from './rows.js';
import { makeStep, requireKnown, type Step, type Tx } from './step.js';
import { planAgainst, stableUuid, validateRows, type Existing } from './validate.js';

const missingDoc = (id: string) => `doc_id ${id} is not a document of this dataset`;

export async function planMockExtraction(
  tx: Tx,
  dir: string,
  file: string,
  knownDocs: Set<string>,
): Promise<Step> {
  // Model governance: the mock provider's version is the file it reads.
  const version = `mock:${file}`;
  const src = readCsv(dir, file, COLUMNS.extractionMock);
  const valid = validateRows(src, extractionRow, (r) => `${r.doc_id}|${r.field_name}`);
  const fk = requireKnown(
    file,
    valid.rows,
    (r) => r.data.doc_id,
    (id) => (knownDocs.has(id) ? true : missingDoc(id)),
    'doc_id',
  );

  const docIds = [...new Set(fk.kept.map((r) => r.data.doc_id))];
  const existingFields = await tx.extractedField.findMany({
    where: { doc_id: { in: docIds }, extraction: { provider: 'MOCK', extractor_version: version } },
    select: { doc_id: true, field_name: true, source_row_hash: true },
  });
  const existing = new Map<string, Existing>(
    existingFields.map((e) => [`${e.doc_id}|${e.field_name}`, { hash: e.source_row_hash }]),
  );
  const plan = planAgainst(file, fk.kept, existing);

  const haveHeader = new Set(
    (
      await tx.extraction.findMany({
        where: { doc_id: { in: docIds }, provider: 'MOCK', extractor_version: version },
        select: { doc_id: true },
      })
    ).map((e) => e.doc_id),
  );
  const newHeaders = [...new Set(plan.insert.map((r) => r.data.doc_id))].filter(
    (d) => !haveHeader.has(d),
  );
  const extractionId = (docId: string) => stableUuid(docId, 'MOCK', version);

  return makeStep(
    'extracted_fields',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...valid.rejections, ...fk.rejections, ...plan.rejections],
    },
    async (w) => {
      await w.extraction.createMany({
        data: newHeaders.map((doc_id) => ({
          id: extractionId(doc_id),
          doc_id,
          provider: 'MOCK',
          extractor_version: version,
        })),
      });
      await w.extractedField.createMany({
        data: plan.insert.map((r) => ({
          id: stableUuid(extractionId(r.data.doc_id), r.data.field_name),
          extraction_id: extractionId(r.data.doc_id),
          doc_id: r.data.doc_id,
          field_name: r.data.field_name,
          value: r.data.value,
          confidence: r.data.confidence,
          source: 'EXTRACTOR',
          source_row_hash: r.hash,
        })),
      });
    },
  );
}

export async function planTruth(
  tx: Tx,
  dir: string,
  file: string,
  knownDocs: Set<string>,
): Promise<Step> {
  const src = readCsv(dir, file, COLUMNS.truth);
  const valid = validateRows(src, truthRow, (r) => r.doc_id);
  const fk = requireKnown(
    file,
    valid.rows,
    (r) => r.data.doc_id,
    (id) => (knownDocs.has(id) ? true : missingDoc(id)),
    'doc_id',
  );
  const existingRows = await tx.documentTruth.findMany({
    select: { doc_id: true, source_row_hash: true },
  });
  const plan = planAgainst(
    file,
    fk.kept,
    new Map(existingRows.map((e) => [e.doc_id, { hash: e.source_row_hash }])),
  );

  return makeStep(
    'document_truth',
    src,
    {
      inserted: plan.insert.length,
      skipped: plan.skipped,
      rejections: [...valid.rejections, ...fk.rejections, ...plan.rejections],
    },
    async (w) => {
      await w.documentTruth.createMany({
        data: plan.insert.map((r) => ({ ...r.data, source_row_hash: r.hash })),
      });
    },
  );
}
