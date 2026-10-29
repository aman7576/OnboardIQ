// Document classification from the text alone (declared_doc_type is never an input).
//  - v1 "keyword rule": the first of a few plain keywords found (the organiser's baseline of spec 2.2).
//  - v2 weighted features: several independent cues per type, tolerant of OCR damage, so a bank
//    statement that merely mentions ELECTRICITY is not mistaken for a bill. Too little evidence = OTHER.
import { cleanLines, editDistance, fold } from './text.js';
import { repairPan } from './ocr.js';
import type { DocType } from './validators.js';

export interface Classification {
  docType: DocType;
  confidence: number;
  scores: Record<string, number>;
}

/** v1: the simple keyword rule. Case-insensitive, exact words, first match wins. */
export function classifyByKeywordRule(text: string): DocType {
  const t = text.toLowerCase();
  if (t.includes('income tax')) return 'PAN_CARD';
  if (t.includes('aadhaar')) return 'AADHAAR_CARD';
  if (t.includes('electricity')) return 'ELECTRICITY_BILL';
  if (t.includes('statement')) return 'BANK_STATEMENT';
  if (t.includes('driving')) return 'DRIVING_LICENCE';
  return 'OTHER';
}

/** True if `needle` occurs in `hay` with at most `tolerance` character errors (sliding window). */
function fuzzyContains(hay: string, needle: string, tolerance: number): boolean {
  if (hay.includes(needle)) return true;
  if (tolerance === 0) return false;
  for (const len of [needle.length - 1, needle.length, needle.length + 1])
    for (let i = 0; i + len <= hay.length; i++)
      if (editDistance(hay.slice(i, i + len), needle) <= tolerance) return true;
  return false;
}

interface Feature {
  weight: number;
  keyword?: string; // matched against the folded text, with OCR tolerance
  test?: (ctx: Ctx) => boolean;
}
interface Ctx {
  folded: string;
  lines: string[];
}

const maskedAadhaar = (c: Ctx) => /X{6,}/.test(c.folded);
const hasPanToken = (c: Ctx) =>
  c.lines.some((l) =>
    l.split(/\s+/).some((t) => {
      const tok = t.replace(/[^A-Za-z0-9]/g, '');
      return (
        tok.length === 10 &&
        repairPan(tok).ok &&
        (tok.slice(5, 9).match(/[0-9]/g)?.length ?? 0) >= 2
      );
    }),
  );

const FEATURES: Record<Exclude<DocType, 'OTHER'>, Feature[]> = {
  PAN_CARD: [
    { weight: 3, keyword: 'INCOMETAXIDENTITYCARD' },
    { weight: 3, keyword: 'PERMANENTACCOUNTNUMBER' },
    { weight: 2, test: hasPanToken },
    { weight: 1, keyword: 'FATHERSNAME' },
  ],
  AADHAAR_CARD: [
    { weight: 3, keyword: 'RESIDENTIDENTITY' },
    { weight: 2, keyword: 'AADHAAR' },
    { weight: 3, test: maskedAadhaar },
    { weight: 1, test: (c) => /(?:^|[A-Z])(?:MALE|FEMALE)(?:$|[A-Z])/.test(c.folded) },
  ],
  ELECTRICITY_BILL: [
    { weight: 3, keyword: 'ELECTRICITYBILL' },
    { weight: 2, keyword: 'CONSUMERNO' },
    { weight: 2, keyword: 'UNITSCONSUMED' },
    { weight: 1, keyword: 'KWH' },
    { weight: 1, keyword: 'POWERDISTRIBUTION' },
  ],
  BANK_STATEMENT: [
    { weight: 3, keyword: 'ACCOUNTSTATEMENT' },
    { weight: 2, keyword: 'STATEMENTDATE' },
    { weight: 1, keyword: 'DESCRIPTION' },
    { weight: 1, keyword: 'SALARYCREDIT' },
    { weight: 1, keyword: 'UPI' },
  ],
  DRIVING_LICENCE: [
    { weight: 3, keyword: 'DRIVINGLICENCE' },
    { weight: 2, keyword: 'VALIDTILL' },
    { weight: 2, keyword: 'DLNO' },
    { weight: 1, keyword: 'TRANSPORT' },
  ],
};

const MIN_EVIDENCE = 4; // below this total weight the document is not recognised: OTHER

export function classifyWeighted(text: string): Classification {
  const ctx: Ctx = { folded: fold(text), lines: cleanLines(text) };
  const scores: Record<string, number> = {};
  for (const [type, features] of Object.entries(FEATURES)) {
    scores[type] = features.reduce((sum, f) => {
      const hit = f.test
        ? f.test(ctx)
        : f.keyword !== undefined &&
          fuzzyContains(
            ctx.folded,
            f.keyword,
            f.keyword.length >= 12 ? 3 : f.keyword.length >= 8 ? 2 : 0,
          );
      return sum + (hit ? f.weight : 0);
    }, 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestType, best] = ranked[0] as [string, number];
  const second = (ranked[1] as [string, number])[1];

  if (best < MIN_EVIDENCE) {
    // Nothing recognisable at all is a confident OTHER; a weak partial match is not.
    return { docType: 'OTHER', confidence: best <= 1 ? 0.93 : 0.55, scores };
  }
  const margin = (best - second) / best;
  const confidence = Math.min(0.99, 0.6 + 0.04 * best) - (margin < 0.5 ? 0.25 : 0);
  return {
    docType: bestType as DocType,
    confidence: Math.max(0.3, Math.round(confidence * 100) / 100),
    scores,
  };
}
