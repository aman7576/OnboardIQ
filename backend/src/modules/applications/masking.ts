// Data protection (spec 6.1.2): PAN is masked in lists, logs and exports; only the last four
// Aadhaar digits exist at all.

/** ZZKPS1234Q -> ZZKXXXXX4Q (keeps the first 3 and the last 2 characters). */
export function maskPan(pan: string): string {
  if (pan.length < 6) return 'X'.repeat(pan.length);
  return `${pan.slice(0, 3)}${'X'.repeat(pan.length - 5)}${pan.slice(-2)}`;
}

/** Display form of the stored last four digits. */
export const maskAadhaar = (last4: string): string => `XXXXXXXX${last4}`;
