// The deterministic extractor ("rules" part of the AI provider). Two versions are kept so they can be compared:
//   1.0.0  regex-only first version: keyword rule for the type, strict regexes, no OCR repair, flat confidence
//   2.0.0  injection guard, weighted classifier, debris removal, OCR repair, deterministic validators and a
//          confidence that falls when a repair was needed or the scan is garbled
import { classifyByKeywordRule, classifyWeighted } from './classifier.js';
import {
  parseAadhaar,
  parseBank,
  parseBill,
  parseLicence,
  parsePan,
  type Found,
} from './fields.js';
import { screenInjection } from './injection.js';
import { cleanLines } from './text.js';
import { FIELDS_BY_TYPE, validateField, type DocType } from './validators.js';
import type { ExtractedFieldOutput } from '../provider.js';

export type RulesVersion = '1.0.0' | '2.0.0';

export interface RulesResult {
  docType: DocType;
  docTypeConfidence: number;
  fields: ExtractedFieldOutput[];
  warnings: string[];
  garbled: boolean;
}

const PARSERS: Record<
  Exclude<DocType, 'OTHER'>,
  (lines: string[], m: { repair: boolean }) => Found
> = {
  PAN_CARD: parsePan,
  AADHAAR_CARD: parseAadhaar,
  ELECTRICITY_BILL: parseBill,
  BANK_STATEMENT: parseBank,
  DRIVING_LICENCE: parseLicence,
};

const STRUCTURED = new Set([
  'pan_number',
  'aadhaar_last4',
  'dob',
  'document_date',
  'valid_until',
  'pincode',
  'gender',
]);

/** OCR garble: debris-only lines, digits or punctuation inside words ("INC0ME", "fictio.nal"). */
export function isGarbled(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some(
      (l) =>
        /^[\s~."'`,;:|_\-*]+$/.test(l) ||
        /[A-Za-z]\d[A-Za-z]/.test(l) ||
        /[A-Za-z][.,][A-Za-z]/.test(l.replace(/\b[A-Za-z]\.[A-Za-z]\./g, '')),
    );
}

/** Confidence of one field (v2): lower when a repair was needed, and for free text on a garbled scan. */
function fieldConfidence(field: string, repairs: number, garbled: boolean): number {
  if (repairs > 0) return 0.7; // a correction was needed: send to a person
  if (STRUCTURED.has(field)) return garbled ? 0.9 : 0.97; // passed its strict validator untouched
  return garbled ? 0.72 : 0.95; // names and addresses cannot be verified structurally
}

export function extractWithRules(text: string, version: RulesVersion): RulesResult {
  const v2 = version === '2.0.0';
  const warnings: string[] = [];

  let body = text;
  if (v2) {
    const screened = screenInjection(text);
    if (screened.suspicious) {
      // Instruction-like text is never followed, and a document that contains it is not trusted as a document.
      return {
        docType: 'OTHER',
        docTypeConfidence: 0.95,
        fields: [],
        warnings: ['prompt_injection_suspected'],
        garbled: isGarbled(text),
      };
    }
    body = screened.text;
  }

  const garbled = isGarbled(body);
  const cls = v2
    ? classifyWeighted(body)
    : { docType: classifyByKeywordRule(body), confidence: 0.9 };
  if (cls.docType === 'OTHER')
    return { docType: 'OTHER', docTypeConfidence: cls.confidence, fields: [], warnings, garbled };

  const lines = v2
    ? cleanLines(body)
    : body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
  const found = PARSERS[cls.docType](lines, { repair: v2 });

  const fields: ExtractedFieldOutput[] = [];
  for (const name of FIELDS_BY_TYPE[cls.docType]) {
    const candidate = found[name];
    if (!candidate) {
      warnings.push(`missing_${name}`);
      continue;
    }
    if (v2 && !validateField(name, candidate.value)) {
      warnings.push(`invalid_${name}`); // an invalid value is not passed on
      continue;
    }
    fields.push({
      name,
      value: candidate.value,
      confidence: v2 ? fieldConfidence(name, candidate.repairs, garbled) : 0.9,
    });
  }
  return { docType: cls.docType, docTypeConfidence: cls.confidence, fields, warnings, garbled };
}
