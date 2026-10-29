// Zod row schemas: one per source file. Inputs are the raw CSV strings; outputs are DB-ready values.
// Only checks needed to store the row safely are applied here. Business checks (PAN format,
// age, pincode match...) belong to the rules engine, which must see the original values.
import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const text = z.string().min(1, 'is empty');
const optText = z.string().transform((v) => (v === '' ? null : v));
const date = text
  .regex(ISO_DATE, 'must be YYYY-MM-DD')
  .refine(isCalendarDate, 'is not a real calendar date')
  .transform((s) => new Date(`${s}T00:00:00Z`));
const optDate = z.union([z.literal('').transform(() => null), date]);
const oneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: `must be one of ${values.join(', ')}` });

const RISK = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const DECLARED_DOC_TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
] as const;
const DOC_TYPES = [...DECLARED_DOC_TYPES, 'OTHER'] as const;

export const occupationRow = z.object({
  occupation_code: text,
  description: text,
  risk_level: oneOf(RISK),
});

export const sanctionsRow = z.object({
  list_id: text,
  name: text,
  alias: optText,
  dob: optDate, // empty dob = name-only match (spec 6.1)
  nationality: text,
  program: text,
});

export const pepRow = z.object({
  pep_id: text,
  name: text,
  dob: date,
  position: text,
  category: oneOf(['DOMESTIC', 'RCA']),
});

export const existingCustomerRow = z.object({
  customer_id: text,
  full_name: text,
  pan_number: text,
  dob: date,
});

export const applicationRow = z.object({
  application_id: text,
  application_date: date,
  full_name: text,
  dob: date,
  gender: text,
  pan_number: text, // stored as declared; R5 judges the format
  aadhaar_last4: z.string().regex(/^[0-9]{4}$/, 'must be exactly 4 digits (never a full Aadhaar)'),
  mobile: text,
  email: text,
  address: text,
  city: text,
  state: text,
  pincode: text,
  occupation_code: text,
  annual_income: z
    .string()
    .regex(/^[0-9]+$/, 'must be a whole number of rupees')
    .transform(Number)
    .refine(Number.isSafeInteger, 'is too large'),
});

export const expectedRow = z.object({
  expected_decision: oneOf(['APPROVE', 'REVIEW', 'REJECT']),
  expected_reason_codes: z.string(),
  expected_name_match_score: z
    .string()
    .regex(/^$|^[01]\.\d{4}$/, 'must be empty or a 4-decimal score'),
  expected_risk_category: z.union([z.literal(''), oneOf(RISK)]),
  expected_rekyc_due_date: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'must be empty or YYYY-MM-DD'),
});

export const documentRow = z.object({
  doc_id: text,
  application_id: text,
  file_name: text,
  declared_doc_type: oneOf(DECLARED_DOC_TYPES),
});

export const extractionRow = z.object({
  doc_id: text,
  field_name: text,
  value: z.string(), // raw; misreads on poor scans are kept exactly as read
  confidence: z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, 'must be a number from 0 to 1'),
});

export const truthRow = z.object({
  doc_id: text,
  doc_type: oneOf(DOC_TYPES),
  name: optText,
  dob: optText,
  gender: optText,
  pan_number: optText,
  aadhaar_last4: optText,
  address: optText,
  pincode: optText,
  document_date: optText,
  valid_until: optText,
});

// All Section 6.1 configuration keys must be present; the object itself is stored unchanged.
export const rulesConfig = z.looseObject({
  version: text,
  min_field_confidence: z.number().min(0).max(1),
  min_age: z.number().int().positive(),
  pan_pattern: text,
  pan_holder_type_char: z.string().length(1),
  name_match_threshold: z.number().min(0).max(1),
  name_reject_below: z.number().min(0).max(1),
  watchlist_match_threshold: z.number().min(0).max(1),
  watchlist_possible_threshold: z.number().min(0).max(1),
  address_proof_max_age_days: z.number().int().positive(),
  medium_risk_income: z.number().nonnegative(),
  rekyc_years: z.object({
    HIGH: z.number().int(),
    MEDIUM: z.number().int(),
    LOW: z.number().int(),
  }),
  name_title_tokens: z.array(text),
  mandatory_documents: z.array(text),
  address_proof_types: z.array(text),
  resubmission_sla_days: z.number().int().positive(),
  checker_sla_hours: z.number().int().positive(),
});
