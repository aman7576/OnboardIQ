// Builds everything the rules read, once: selected documents, usable fields, name score, screening.
import { ageOn } from './dates.js';
import { atLeast, nameSimilarity } from './name.js';
import { screen } from './screening.js';
import type {
  ApplicationInput,
  ClassifiedDocument,
  EngineConfig,
  ExistingCustomer,
  Screening,
  Watchlists,
} from './types.js';

// Spec 6.1 "Required fields" by classified document type.
export const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  PAN_CARD: ['name', 'dob', 'pan_number'],
  AADHAAR_CARD: ['name', 'dob', 'aadhaar_last4'],
  ELECTRICITY_BILL: ['pincode', 'document_date'],
  BANK_STATEMENT: ['pincode', 'document_date'],
  DRIVING_LICENCE: ['pincode', 'valid_until'],
};

export interface NameComparison {
  source: 'PAN_CARD' | 'AADHAAR_CARD';
  docId: string;
  documentName: string;
  similarity: number;
}

export interface RuleContext {
  app: ApplicationInput;
  config: EngineConfig;
  documents: ClassifiedDocument[];
  selected: {
    pan: ClassifiedDocument | undefined;
    aadhaar: ClassifiedDocument | undefined;
    addressProof: ClassifiedDocument | undefined;
  };
  /** The value of a field if it is present, not empty and at least min_field_confidence; else undefined. */
  usable: (doc: ClassifiedDocument | undefined, field: string) => string | undefined;
  nameComparisons: NameComparison[];
  nameScore: number | null; // lowest similarity; null when neither PAN nor Aadhaar name is usable
  ageYears: number;
  screening: { sanctions: Screening; pep: Screening };
  existingPans: ReadonlySet<string>;
}

/** For each type the document with the lowest doc_id is used (spec 6.1 "Document selection"). */
const lowestDocId = (docs: ClassifiedDocument[]): ClassifiedDocument | undefined =>
  [...docs].sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0))[0];

export function buildContext(
  app: ApplicationInput,
  documents: ClassifiedDocument[],
  config: EngineConfig,
  watchlists: Watchlists,
  existingCustomers: readonly ExistingCustomer[],
): RuleContext {
  const ofType = (...types: string[]) =>
    lowestDocId(documents.filter((d) => types.includes(d.docType)));
  const selected = {
    pan: ofType('PAN_CARD'),
    aadhaar: ofType('AADHAAR_CARD'),
    addressProof: ofType(...config.address_proof_types),
  };

  const usable: RuleContext['usable'] = (doc, field) => {
    const f = doc?.fields.find((x) => x.name === field);
    return f && f.value.trim() !== '' && atLeast(f.confidence, config.min_field_confidence)
      ? f.value
      : undefined;
  };

  const nameComparisons: NameComparison[] = [];
  for (const [source, doc] of [
    ['PAN_CARD', selected.pan],
    ['AADHAAR_CARD', selected.aadhaar],
  ] as const) {
    const documentName = usable(doc, 'name');
    if (doc && documentName !== undefined)
      nameComparisons.push({
        source,
        docId: doc.docId,
        documentName,
        similarity: nameSimilarity(app.fullName, documentName, config.name_title_tokens),
      });
  }

  return {
    app,
    config,
    documents,
    selected,
    usable,
    nameComparisons,
    nameScore: nameComparisons.length
      ? Math.min(...nameComparisons.map((c) => c.similarity))
      : null,
    ageYears: ageOn(app.dob, app.applicationDate),
    screening: {
      sanctions: screen(app.fullName, app.dob, watchlists.sanctions, config),
      pep: screen(app.fullName, app.dob, watchlists.pep, config),
    },
    existingPans: new Set(existingCustomers.map((c) => c.panNumber)),
  };
}
