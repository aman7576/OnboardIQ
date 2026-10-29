// R12: address proof is a DRIVING_LICENCE and valid_until is earlier than application_date -> REVIEW
import { daysBetween } from '../dates.js';
import type { Rule } from './rule.js';

export const r12: Rule = {
  id: 'R12',
  code: 'DOCUMENT_EXPIRED',
  outcome: 'REVIEW',
  needs: ['address proof type', 'valid_until (usable)'],
  test: ({ app, selected, usable }) => {
    const proof = selected.addressProof;
    if (proof?.docType !== 'DRIVING_LICENCE')
      return { triggered: false, skipped: 'address proof is not a driving licence' };
    const validUntil = usable(proof, 'valid_until');
    if (validUntil === undefined)
      return { triggered: false, skipped: 'valid_until is missing or not usable' };
    return {
      triggered: daysBetween(app.applicationDate, validUntil) < 0,
      compared: { validUntil, applicationDate: app.applicationDate },
    };
  },
};
