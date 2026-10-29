// Deterministic validators for extracted values. A model or a regex may propose a value; these decide
// whether it is well-formed. They never look at the document text.
export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PINCODE_FORMAT = /^[1-9][0-9]{5}$/;
export const LAST4_FORMAT = /^[0-9]{4}$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isValidPan = (v: string): boolean => PAN_FORMAT.test(v);
export const isValidPincode = (v: string): boolean => PINCODE_FORMAT.test(v);
export const isValidLast4 = (v: string): boolean => LAST4_FORMAT.test(v);
export const isValidGender = (v: string): boolean => v === 'M' || v === 'F';

export function isRealIsoDate(v: string): boolean {
  const m = ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v && Number(m[1]) >= 1900 && Number(m[1]) <= 2100;
}

export const isValidName = (v: string): boolean =>
  /^[A-Za-z][A-Za-z .'-]{1,118}$/.test(v) && v.replace(/[^A-Za-z]/g, '').length >= 2;
export const isValidAddress = (v: string): boolean => v.length >= 6 && v.length <= 300;

export const DOC_TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
  'OTHER',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** The fields each document type is expected to yield (same sets as the supplied extraction files). */
export const FIELDS_BY_TYPE: Record<DocType, readonly string[]> = {
  PAN_CARD: ['name', 'dob', 'pan_number'],
  AADHAAR_CARD: ['name', 'dob', 'gender', 'aadhaar_last4', 'address', 'pincode'],
  ELECTRICITY_BILL: ['name', 'address', 'pincode', 'document_date'],
  BANK_STATEMENT: ['name', 'address', 'pincode', 'document_date'],
  DRIVING_LICENCE: ['name', 'dob', 'address', 'pincode', 'valid_until'],
  OTHER: [],
};

/** True when `value` is acceptable for `field` in its normalised form. */
export function validateField(field: string, value: string): boolean {
  switch (field) {
    case 'name':
      return isValidName(value);
    case 'dob':
    case 'document_date':
    case 'valid_until':
      return isRealIsoDate(value);
    case 'gender':
      return isValidGender(value);
    case 'pan_number':
      return isValidPan(value);
    case 'aadhaar_last4':
      return isValidLast4(value);
    case 'pincode':
      return isValidPincode(value);
    case 'address':
      return isValidAddress(value);
    default:
      return false;
  }
}
