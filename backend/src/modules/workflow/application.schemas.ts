// Application form validation (spec section 4). The PAN pattern comes from the rule configuration;
// the other patterns are the ones printed in the specification.
import { z } from 'zod';

export const MOBILE = /^[6-9][0-9]{9}$/;
export const PINCODE = /^[1-9][0-9]{5}$/;
export const AADHAAR_LAST4 = /^[0-9]{4}$/;

const text = (max = 200) => z.string().trim().min(1, 'is required').max(max);

/** Calendar date YYYY-MM-DD that exists and is not after `today` (IST). */
function pastDate(today: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'is not a real calendar date')
    .refine((s) => s >= '1900-01-01', 'is too far in the past')
    .refine((s) => s <= today, 'must not be in the future');
}

export function applicationBody(panPattern: string, today: string) {
  return z.strictObject({
    full_name: text(120),
    dob: pastDate(today),
    gender: z.enum(['M', 'F'], { error: 'must be M or F' }),
    pan_number: z.string().regex(new RegExp(panPattern), 'must match the PAN format AAAAA9999A'),
    // Only the last four digits are ever accepted; a full number is refused with a clear message.
    aadhaar_last4: z
      .string()
      .refine(
        (v) => !/^\d{5,}$/.test(v.replace(/\s/g, '')),
        'Only the last 4 digits of Aadhaar are accepted. Do not enter the full 12-digit number.',
      )
      .pipe(z.string().regex(AADHAAR_LAST4, 'must be exactly 4 digits')),
    mobile: z.string().regex(MOBILE, 'must be a 10-digit Indian mobile number starting 6-9'),
    email: z.email('must be a valid e-mail address').max(254),
    address: text(300),
    city: text(80),
    state: text(80),
    pincode: z.string().regex(PINCODE, 'must be a 6-digit pincode not starting with 0'),
    occupation_code: text(60),
    annual_income: z
      .number({ error: 'must be a number' })
      .int('must be a whole number of rupees')
      .min(0, 'must not be negative')
      .max(10_000_000_000),
    consent_kyc: z.literal(true, { error: 'must be true: consent to KYC checks is mandatory' }),
  });
}

export type ApplicationBody = z.infer<ReturnType<typeof applicationBody>>;

export const FIELD_NAMES = [
  'doc_type',
  'name',
  'dob',
  'gender',
  'pan_number',
  'aadhaar_last4',
  'address',
  'pincode',
  'document_date',
  'valid_until',
] as const;
export const DOC_TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
  'OTHER',
] as const;

const isoDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Officer-entered replacement values must already be in the normalised form the extractor uses. */
export function fieldValueProblem(
  field: (typeof FIELD_NAMES)[number],
  value: string,
): string | null {
  const checks: Record<(typeof FIELD_NAMES)[number], () => boolean> = {
    doc_type: () => (DOC_TYPES as readonly string[]).includes(value),
    name: () => value.length <= 120,
    dob: () => isoDate(value),
    gender: () => value === 'M' || value === 'F',
    pan_number: () => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value),
    aadhaar_last4: () => AADHAAR_LAST4.test(value),
    address: () => value.length <= 300,
    pincode: () => PINCODE.test(value),
    document_date: () => isoDate(value),
    valid_until: () => isoDate(value),
  };
  return checks[field]()
    ? null
    : `is not a valid ${field} value (expected the normalised form, for example dates as YYYY-MM-DD)`;
}

// Spec FR-6 asks for "a field, new value, reason". The spec gives no minimum length for the reason, so it only
// has to be non-empty (ASSUMPTION); the 10-character minimum applies to officer recommendations.
export const correctionsBody = z.strictObject({
  corrections: z
    .array(
      z.strictObject({
        doc_id: z.string().min(1).max(40),
        field_name: z.enum(FIELD_NAMES, { error: `must be one of ${FIELD_NAMES.join(', ')}` }),
        new_value: z.string().trim().min(1, 'is required').max(500),
        reason: z.string().trim().min(1, 'a reason is required').max(2000),
      }),
    )
    .min(1, 'at least one correction is required')
    .max(20),
});

export type CorrectionsBody = z.infer<typeof correctionsBody>;
