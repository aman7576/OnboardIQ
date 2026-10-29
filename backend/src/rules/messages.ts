// Plain-language explanations of the reason codes for APPLICANTS (spec FR-8: "every reason code maps to a
// readable message"). They deliberately say nothing about screening: an applicant must not see watchlist
// details, so the sanctions/PEP codes share a generic compliance message.
import type { ReasonCode } from './types.js';

const COMPLIANCE = 'Your application needs an additional compliance review.';

export function applicantMessage(
  code: ReasonCode,
  config: { address_proof_max_age_days: number; min_age: number },
): string {
  const messages: Record<ReasonCode, string> = {
    DOCUMENT_MISSING:
      'A required document (PAN card, Aadhaar card or an address proof) is missing.',
    DOCUMENT_TYPE_MISMATCH: 'A document you uploaded does not look like the type you selected.',
    LOW_EXTRACTION_CONFIDENCE:
      'Some details on your documents could not be read clearly, so an officer will check them.',
    AGE_BELOW_18: `Applicants must be at least ${config.min_age} years old.`,
    PAN_INVALID: 'The PAN number entered is not a valid individual PAN.',
    PAN_MISMATCH: 'The PAN on your PAN card does not match the PAN you entered.',
    DOB_MISMATCH: 'The date of birth on your documents does not match the date you entered.',
    AADHAAR_MISMATCH: 'The last 4 digits on your Aadhaar do not match the digits you entered.',
    NAME_MISMATCH: 'The name on your documents does not match the name you entered.',
    SANCTIONS_MATCH: 'We are unable to open an account for this application.',
    NAME_MISMATCH_MINOR:
      'The name on your documents differs slightly from the name you entered, so an officer will check it.',
    DOCUMENT_EXPIRED: 'Your driving licence has expired. Please upload a valid address proof.',
    ADDRESS_PROOF_STALE: `Your address proof is older than ${config.address_proof_max_age_days} days or dated in the future. Please upload a recent one.`,
    ADDRESS_MISMATCH: 'The pincode on your address proof does not match the pincode you entered.',
    SANCTIONS_POSSIBLE_MATCH: COMPLIANCE,
    PEP_MATCH: COMPLIANCE,
    DUPLICATE_CUSTOMER: 'We may already hold an account for you, so an officer will check this.',
  };
  return messages[code];
}

/** Messages for a list of codes, without repeating one. */
export const applicantMessages = (
  codes: readonly string[],
  config: Parameters<typeof applicantMessage>[1],
): string[] => [...new Set(codes.map((c) => applicantMessage(c as ReasonCode, config)))];
