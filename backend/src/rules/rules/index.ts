import { r1 } from './r01-document-missing.js';
import { r2 } from './r02-document-type-mismatch.js';
import { r3 } from './r03-low-extraction-confidence.js';
import { r4 } from './r04-age-below-minimum.js';
import { r5 } from './r05-pan-invalid.js';
import { r6 } from './r06-pan-mismatch.js';
import { r7 } from './r07-dob-mismatch.js';
import { r8 } from './r08-aadhaar-mismatch.js';
import { r9 } from './r09-name-mismatch.js';
import { r10 } from './r10-sanctions-match.js';
import { r11 } from './r11-name-mismatch-minor.js';
import { r12 } from './r12-document-expired.js';
import { r13 } from './r13-address-proof-stale.js';
import { r14 } from './r14-address-mismatch.js';
import { r15 } from './r15-sanctions-possible.js';
import { r16 } from './r16-pep-match.js';
import { r17 } from './r17-duplicate-customer.js';
import type { Rule } from './rule.js';

/** Evaluation order = rule order; reason codes are reported in this order (R1 first). */
export const RULES: readonly Rule[] = [
  r1,
  r2,
  r3,
  r4,
  r5,
  r6,
  r7,
  r8,
  r9,
  r10,
  r11,
  r12,
  r13,
  r14,
  r15,
  r16,
  r17,
];
