// Loads engine inputs straight from the supplied data files (no database), so the batch command,
// the golden test and the API can all feed the same pure engine. Files are only read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { datasetFiles, REFERENCE_FILES, type DatasetName } from '../import/manifest.js';
import { rulesConfig } from '../import/rows.js';
import type {
  ApplicationInput,
  ClassifiedDocument,
  EngineConfig,
  ExistingCustomer,
  RiskLevel,
  Watchlists,
} from './types.js';

type Row = Record<string, string>;
const csv = (dir: string, file: string): Row[] =>
  parse(readFileSync(join(dir, file), 'utf8'), { columns: true, skip_empty_lines: true }) as Row[];
const need = (row: Row, key: string): string => {
  const v = row[key];
  if (v === undefined) throw new Error(`missing column ${key}`);
  return v;
};

export interface ReferenceInputs {
  config: EngineConfig;
  watchlists: Watchlists;
  existingCustomers: ExistingCustomer[];
}

export function loadReference(dir: string): ReferenceInputs {
  const raw = JSON.parse(readFileSync(join(dir, REFERENCE_FILES.rulesConfig), 'utf8')) as unknown;
  const occupations: Record<string, RiskLevel> = {};
  for (const r of csv(dir, REFERENCE_FILES.occupations))
    occupations[need(r, 'occupation_code')] = need(r, 'risk_level') as RiskLevel;
  return {
    config: { ...rulesConfig.parse(raw), occupations },
    watchlists: {
      sanctions: csv(dir, REFERENCE_FILES.sanctions).map((r) => ({
        id: need(r, 'list_id'),
        name: need(r, 'name'),
        alias: need(r, 'alias') || null,
        dob: need(r, 'dob') || null,
      })),
      pep: csv(dir, REFERENCE_FILES.pep).map((r) => ({
        id: need(r, 'pep_id'),
        name: need(r, 'name'),
        alias: null,
        dob: need(r, 'dob'),
      })),
    },
    existingCustomers: csv(dir, REFERENCE_FILES.existingCustomers).map((r) => ({
      customerId: need(r, 'customer_id'),
      panNumber: need(r, 'pan_number'),
    })),
  };
}

export interface CaseInput {
  application: ApplicationInput;
  documents: ClassifiedDocument[];
  expected?: Row; // the expected_* columns of the sample file
}

export interface CaseFiles {
  applications: string;
  documents: string;
  extraction: string;
}

/** One case per application: declared data + each document with the extraction output (long format). */
export function loadCasesFromFiles(files: CaseFiles): CaseInput[] {
  const read = (path: string): Row[] =>
    parse(readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true }) as Row[];
  const extraction = new Map<string, Row[]>();
  for (const r of read(files.extraction)) {
    const id = need(r, 'doc_id');
    extraction.set(id, [...(extraction.get(id) ?? []), r]);
  }
  const docsByApp = new Map<string, Row[]>();
  for (const r of read(files.documents)) {
    const id = need(r, 'application_id');
    docsByApp.set(id, [...(docsByApp.get(id) ?? []), r]);
  }

  return read(files.applications).map((a) => {
    const documents: ClassifiedDocument[] = (docsByApp.get(need(a, 'application_id')) ?? []).map(
      (d) => {
        const rows = extraction.get(need(d, 'doc_id')) ?? [];
        const type = rows.find((r) => r.field_name === 'doc_type');
        return {
          docId: need(d, 'doc_id'),
          declaredDocType: need(d, 'declared_doc_type'),
          docType: type?.value ?? 'OTHER', // spec FR-3: unknown document is OTHER with confidence 0.00
          docTypeConfidence: Number(type?.confidence ?? 0),
          fields: rows
            .filter((r) => r.field_name !== 'doc_type')
            .map((r) => ({
              name: need(r, 'field_name'),
              value: need(r, 'value'),
              confidence: Number(need(r, 'confidence')),
            })),
        };
      },
    );
    return {
      application: {
        applicationId: need(a, 'application_id'),
        applicationDate: need(a, 'application_date'),
        fullName: need(a, 'full_name'),
        dob: need(a, 'dob'),
        panNumber: need(a, 'pan_number'),
        aadhaarLast4: need(a, 'aadhaar_last4'),
        pincode: need(a, 'pincode'),
        occupationCode: need(a, 'occupation_code'),
        annualIncome: Number(need(a, 'annual_income')),
      },
      documents,
      ...('expected_decision' in a ? { expected: a } : {}),
    };
  });
}

/** The supplied sample or evaluation files (mock extraction) in a data folder. */
export function loadCases(dir: string, dataset: DatasetName): CaseInput[] {
  const files = datasetFiles(dataset);
  return loadCasesFromFiles({
    applications: join(dir, files.applications),
    documents: join(dir, files.documents),
    extraction: join(dir, files.extractionMock),
  });
}
