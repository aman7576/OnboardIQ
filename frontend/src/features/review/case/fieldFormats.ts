// What a corrected value should look like (the extractor's normalised form). The backend checks it again.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const FIELD_HINTS: Record<string, string> = {
  doc_type: 'PAN_CARD, AADHAAR_CARD, ELECTRICITY_BILL, BANK_STATEMENT, DRIVING_LICENCE or OTHER',
  name: 'Full name as printed',
  dob: 'YYYY-MM-DD',
  gender: 'M or F',
  pan_number: 'AAAAA9999A, capital letters',
  aadhaar_last4: '4 digits',
  address: 'Address as printed',
  pincode: '6 digits',
  document_date: 'YYYY-MM-DD',
  valid_until: 'YYYY-MM-DD',
};

const CHECKS: Record<string, (v: string) => boolean> = {
  doc_type: (v) =>
    [
      'PAN_CARD',
      'AADHAAR_CARD',
      'ELECTRICITY_BILL',
      'BANK_STATEMENT',
      'DRIVING_LICENCE',
      'OTHER',
    ].includes(v),
  dob: (v) => ISO.test(v),
  document_date: (v) => ISO.test(v),
  valid_until: (v) => ISO.test(v),
  gender: (v) => v === 'M' || v === 'F',
  pan_number: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
  aadhaar_last4: (v) => /^\d{4}$/.test(v),
  pincode: (v) => /^[1-9]\d{5}$/.test(v),
};

/** Returns a message if the value is clearly not in the expected form. */
export function valueProblem(field: string, value: string): string | null {
  if (!value.trim()) return 'Enter the corrected value.';
  const ok = CHECKS[field]?.(value.trim());
  return ok === false ? `Use this form: ${FIELD_HINTS[field] ?? 'the normalised form'}.` : null;
}

export const correctionKey = (c: { doc_id: string; field_name: string }) =>
  `${c.doc_id}|${c.field_name}`;
