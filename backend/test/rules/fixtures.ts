// A clean application as in the spec's worked-example defaults, plus helpers to damage one thing at a time.
import { evaluate } from '../../src/rules/evaluate.js';
import { loadReference } from '../../src/rules/file-data.js';
import type {
  ApplicationInput,
  ClassifiedDocument,
  EngineConfig,
  Evaluation,
  ExistingCustomer,
  Watchlists,
} from '../../src/rules/types.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';

export const reference = loadReference(REAL_DATA_DIR); // thresholds, lists and occupations from the supplied files

export const baseApp: ApplicationInput = {
  applicationId: 'T1',
  applicationDate: '2026-03-04',
  fullName: 'Ravi Kumar Sharma',
  dob: '1990-05-15',
  panNumber: 'ZZKPS1234Q',
  aadhaarLast4: '4821',
  pincode: '400001',
  occupationCode: 'SALARIED_PRIVATE',
  annualIncome: 900000,
};

const f = (name: string, value: string, confidence = 0.95) => ({ name, value, confidence });

export const pan = (over: Partial<ClassifiedDocument> = {}): ClassifiedDocument => ({
  docId: 'D1',
  declaredDocType: 'PAN_CARD',
  docType: 'PAN_CARD',
  docTypeConfidence: 0.97,
  fields: [f('name', 'Ravi Kumar Sharma'), f('dob', '1990-05-15'), f('pan_number', 'ZZKPS1234Q')],
  ...over,
});
export const aadhaar = (over: Partial<ClassifiedDocument> = {}): ClassifiedDocument => ({
  docId: 'D2',
  declaredDocType: 'AADHAAR_CARD',
  docType: 'AADHAAR_CARD',
  docTypeConfidence: 0.97,
  fields: [
    f('name', 'Ravi Kumar Sharma'),
    f('dob', '1990-05-15'),
    f('gender', 'M'),
    f('aadhaar_last4', '4821'),
    f('pincode', '400001'),
  ],
  ...over,
});
export const bill = (over: Partial<ClassifiedDocument> = {}): ClassifiedDocument => ({
  docId: 'D3',
  declaredDocType: 'ELECTRICITY_BILL',
  docType: 'ELECTRICITY_BILL',
  docTypeConfidence: 0.97,
  fields: [
    f('name', 'Ravi Kumar Sharma'),
    f('pincode', '400001'),
    f('document_date', '2026-02-12'),
  ],
  ...over,
});
export const licence = (
  validUntil = '2030-01-01',
  over: Partial<ClassifiedDocument> = {},
): ClassifiedDocument => ({
  docId: 'D3',
  declaredDocType: 'DRIVING_LICENCE',
  docType: 'DRIVING_LICENCE',
  docTypeConfidence: 0.97,
  fields: [f('name', 'Ravi Kumar Sharma'), f('pincode', '400001'), f('valid_until', validUntil)],
  ...over,
});

/** Same document with one field replaced (or added) at the given confidence. */
export const withField = (
  doc: ClassifiedDocument,
  name: string,
  value: string,
  confidence = 0.95,
): ClassifiedDocument => ({
  ...doc,
  fields: [...doc.fields.filter((x) => x.name !== name), f(name, value, confidence)],
});
export const withoutField = (doc: ClassifiedDocument, name: string): ClassifiedDocument => ({
  ...doc,
  fields: doc.fields.filter((x) => x.name !== name),
});

export const cleanDocs = (): ClassifiedDocument[] => [pan(), aadhaar(), bill()];
const noLists: Watchlists = { sanctions: [], pep: [] };

export function run(
  parts: {
    app?: Partial<ApplicationInput>;
    docs?: ClassifiedDocument[];
    config?: Partial<EngineConfig>;
    lists?: Watchlists;
    customers?: ExistingCustomer[];
  } = {},
): Evaluation {
  return evaluate(
    { ...baseApp, ...parts.app },
    parts.docs ?? cleanDocs(),
    { ...reference.config, ...parts.config },
    parts.lists ?? noLists, // most rule tests need no watchlist hit
    parts.customers ?? [],
  );
}

export const codes = (e: Evaluation) => e.reasonCodes;
export const traceOf = (e: Evaluation, rule: string) => e.trace.find((t) => t.rule === rule);
