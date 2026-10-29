// documents.csv joined with document_text.jsonl: one stored document per doc_id, with its SHA-256.
import { z } from 'zod';
import { COLUMNS, MAX_DOCUMENT_BYTES, type DatasetName } from './manifest.js';
import { readCsv, readJsonl, sha256, type Rejection } from './read.js';
import { documentRow } from './rows.js';
import { makeStep, requireKnown, type Step, type Tx } from './step.js';
import { planAgainst, validateRows, type Existing } from './validate.js';

const textRow = z.object({
  doc_id: z.string().min(1, 'is empty'),
  application_id: z.string(),
  file_name: z.string(),
  text: z.string(),
});

export async function planDocuments(
  tx: Tx,
  dir: string,
  files: { documents: string; documentText: string },
  dataset: DatasetName,
  knownApplications: Map<string, DatasetName>,
): Promise<{ step: Step; knownDocs: Set<string> }> {
  const docsSrc = readCsv(dir, files.documents, COLUMNS.documents);
  const textSrc = readJsonl(dir, files.documentText, COLUMNS.documentText);
  const docs = validateRows(docsSrc, documentRow, (r) => r.doc_id);
  const texts = validateRows(textSrc, textRow, (r) => r.doc_id);
  const rejections: Rejection[] = [...docs.rejections, ...texts.rejections];

  const appsInDb = await tx.application.findMany({
    where: { application_id: { in: docs.rows.map((r) => r.data.application_id) } },
    select: { application_id: true, dataset: true },
  });
  const appDataset = new Map<string, string>(appsInDb.map((a) => [a.application_id, a.dataset]));
  const fk = requireKnown(
    files.documents,
    docs.rows,
    (r) => r.data.application_id,
    (id) => {
      if (knownApplications.has(id)) return true;
      const other = appDataset.get(id);
      return other ? `application_id ${id} belongs to dataset ${other}, not ${dataset}` : undefined;
    },
    'application_id',
  );
  rejections.push(...fk.rejections);

  // Join each document with its text and hash the bytes that would be written to <file_name>.
  const textByDoc = new Map(texts.rows.map((t) => [t.key, t]));
  const joined = [];
  const contentSeen = new Map<string, string>(); // application_id|sha256 -> doc_id
  for (const doc of fk.kept) {
    const d = doc.data;
    const t = textByDoc.get(d.doc_id);
    const fail = (reason: string) =>
      rejections.push({ file: files.documents, line: doc.line, reason });
    if (d.file_name !== `${d.doc_id}.txt`) {
      fail(`file_name ${d.file_name} must be ${d.doc_id}.txt`);
      continue;
    }
    if (!t) {
      fail(`no text for ${d.doc_id} in ${files.documentText}`);
      continue;
    }
    if (t.data.application_id !== d.application_id || t.data.file_name !== d.file_name) {
      fail(`application_id/file_name differ from ${files.documentText} line ${t.line}`);
      continue;
    }
    const bytes = Buffer.byteLength(t.data.text, 'utf8');
    if (bytes > MAX_DOCUMENT_BYTES) {
      fail(`text is ${bytes} bytes, limit is ${MAX_DOCUMENT_BYTES}`);
      continue;
    }
    const sha = sha256(Buffer.from(t.data.text, 'utf8'));
    const dup = contentSeen.get(`${d.application_id}|${sha}`);
    if (dup) {
      fail(`same content as ${dup} for application ${d.application_id}`);
      continue;
    }
    contentSeen.set(`${d.application_id}|${sha}`, d.doc_id);
    joined.push({ ...doc, hash: sha256(doc.hash + sha), text: t.data.text, sha, bytes });
  }
  for (const t of texts.rows)
    if (!docs.rows.some((d) => d.key === t.key))
      rejections.push({
        file: files.documentText,
        line: t.line,
        reason: `doc_id ${t.key} is not in ${files.documents}`,
      });

  const existingRows = await tx.document.findMany({
    where: {
      OR: [
        { doc_id: { in: joined.map((j) => j.key) } },
        { application_id: { in: joined.map((j) => j.data.application_id) } },
      ],
    },
    select: {
      doc_id: true,
      application_id: true,
      sha256: true,
      source_row_hash: true,
      dataset: true,
    },
  });
  const existing = new Map<string, Existing>(
    existingRows.map((e) => [e.doc_id, { hash: e.source_row_hash, dataset: e.dataset }]),
  );
  const storedContent = new Map(
    existingRows.map((e) => [`${e.application_id}|${e.sha256}`, e.doc_id]),
  );
  const plan = planAgainst(files.documents, joined, existing, dataset);
  const insert = plan.insert.filter((j) => {
    const other = storedContent.get(`${j.data.application_id}|${j.sha}`);
    if (other && other !== j.key)
      rejections.push({
        file: files.documents,
        line: j.line,
        reason: `same content already stored as ${other} (SHA-256 idempotency)`,
      });
    return !other;
  });
  rejections.push(...plan.rejections);

  const knownDocs = new Set(joined.map((j) => j.key));
  for (const e of await tx.document.findMany({ where: { dataset }, select: { doc_id: true } }))
    knownDocs.add(e.doc_id);

  const step = makeStep(
    'documents',
    [docsSrc, textSrc],
    { inserted: insert.length, skipped: plan.skipped, rejections },
    async (w) => {
      await w.document.createMany({
        data: insert.map((j) => ({
          doc_id: j.data.doc_id,
          application_id: j.data.application_id,
          file_name: j.data.file_name,
          declared_doc_type: j.data.declared_doc_type,
          text: j.text,
          sha256: j.sha,
          size_bytes: j.bytes,
          dataset,
          source_row_hash: j.hash,
        })),
      });
    },
  );
  return { step, knownDocs };
}
