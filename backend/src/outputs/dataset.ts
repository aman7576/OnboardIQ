// One evaluation or sample dataset, from the database (the normal path) or from the supplied files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { PrismaClient } from '@prisma/client';
import { datasetFiles, type DatasetName } from '../import/manifest.js';
import { loadCases, loadReference, type ReferenceInputs } from '../rules/file-data.js';
import type { ApplicationInput, ClassifiedDocument } from '../rules/types.js';
import { loadReference as loadDbReference } from '../modules/workflow/engine-data.js';

export interface OutputDocument {
  docId: string;
  applicationId: string;
  declaredDocType: string;
  text: string;
}

export interface Dataset {
  name: DatasetName;
  source: 'database' | 'files';
  applications: (ApplicationInput & { gender: string })[];
  documents: OutputDocument[]; // ordered by doc_id
  /** The mock provider's classified documents per application (the supplied extraction_mock rows). */
  mockDocuments: Map<string, ClassifiedDocument[]>;
  /** Only the sample has these. */
  expected: Map<string, Record<string, string>>;
  truth: Map<string, Record<string, string>>;
  reference: ReferenceInputs;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

export async function loadDatasetFromDb(prisma: PrismaClient, name: DatasetName): Promise<Dataset> {
  const dataset = name;
  const apps = await prisma.application.findMany({
    where: { dataset },
    orderBy: { application_id: 'asc' },
  });
  const docs = await prisma.document.findMany({
    where: { dataset },
    orderBy: { doc_id: 'asc' },
    // Only the MOCK provider's rows: the mandatory output must not depend on other providers' results.
    include: { extractions: { where: { provider: 'MOCK' }, include: { fields: true } } },
  });
  const mockDocuments = new Map<string, ClassifiedDocument[]>();
  for (const d of docs) {
    const rows = d.extractions.flatMap((e) => e.fields);
    const type = rows.find((r) => r.field_name === 'doc_type');
    const doc: ClassifiedDocument = {
      docId: d.doc_id,
      declaredDocType: d.declared_doc_type,
      docType: type?.value ?? 'OTHER', // spec FR-3: a document with no extraction is OTHER, confidence 0.00
      docTypeConfidence: Number(type?.confidence ?? 0),
      fields: rows
        .filter((r) => r.field_name !== 'doc_type')
        .sort((a, b) => a.field_name.localeCompare(b.field_name))
        .map((r) => ({ name: r.field_name, value: r.value, confidence: Number(r.confidence) })),
    };
    mockDocuments.set(d.application_id, [...(mockDocuments.get(d.application_id) ?? []), doc]);
  }
  const expected = new Map<string, Record<string, string>>();
  for (const e of await prisma.applicationExpected.findMany({
    where: { application: { dataset } },
  }))
    expected.set(e.application_id, { ...e });
  const truth = new Map<string, Record<string, string>>();
  for (const t of await prisma.documentTruth.findMany({
    where: { document: { dataset } },
    orderBy: { doc_id: 'asc' },
  }))
    truth.set(
      t.doc_id,
      Object.fromEntries(
        Object.entries(t).filter(
          ([k, v]) => v !== null && k !== 'doc_id' && k !== 'source_row_hash',
        ),
      ) as Record<string, string>,
    );

  const reference = await loadDbReference(prisma);
  return {
    name,
    source: 'database',
    applications: apps.map((a) => ({
      applicationId: a.application_id,
      applicationDate: day(a.application_date),
      fullName: a.full_name,
      dob: day(a.dob),
      panNumber: a.pan_number,
      aadhaarLast4: a.aadhaar_last4,
      pincode: a.pincode,
      occupationCode: a.occupation_code,
      annualIncome: a.annual_income,
      gender: a.gender,
    })),
    documents: docs.map((d) => ({
      docId: d.doc_id,
      applicationId: d.application_id,
      declaredDocType: d.declared_doc_type,
      text: d.text,
    })),
    mockDocuments,
    expected,
    truth,
    reference: {
      config: reference.config,
      watchlists: reference.watchlists,
      existingCustomers: reference.existingCustomers,
    },
  };
}

/** The same dataset read straight from the supplied files (used to cross-check the database path). */
export function loadDatasetFromFiles(dir: string, name: DatasetName): Dataset {
  const files = datasetFiles(name);
  const cases = loadCases(dir, name);
  const texts = new Map(
    readFileSync(join(dir, files.documentText), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const o = JSON.parse(l) as { doc_id: string; text: string };
        return [o.doc_id, o.text] as const;
      }),
  );
  const documents: OutputDocument[] = cases
    .flatMap((c) =>
      c.documents.map((d) => ({
        docId: d.docId,
        applicationId: c.application.applicationId,
        declaredDocType: d.declaredDocType,
        text: texts.get(d.docId) ?? '',
      })),
    )
    .sort((a, b) => (a.docId < b.docId ? -1 : 1));
  const gender = new Map<string, string>();
  const applicationRows = readFileSync(join(dir, files.applications), 'utf8');
  for (const line of applicationRows.split(/\r?\n/).slice(1)) {
    const cells = line.split(',');
    if (cells[0]) gender.set(cells[0], cells[4] ?? '');
  }
  const truth = new Map<string, Record<string, string>>();
  if (files.truth) {
    const rows = parse(readFileSync(join(dir, files.truth), 'utf8'), {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];
    for (const r of rows)
      truth.set(
        r.doc_id as string,
        Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== 'doc_id' && v !== '')),
      );
  }
  return {
    name,
    source: 'files',
    applications: cases.map((c) => ({
      ...c.application,
      gender: gender.get(c.application.applicationId) ?? '',
    })),
    documents,
    mockDocuments: new Map(cases.map((c) => [c.application.applicationId, c.documents])),
    expected: new Map(
      cases
        .filter((c) => c.expected)
        .map((c) => [c.application.applicationId, c.expected as Record<string, string>]),
    ),
    truth,
    reference: loadReference(dir),
  };
}
