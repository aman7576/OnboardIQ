// R13: address proof is an ELECTRICITY_BILL or BANK_STATEMENT and document_date is more than the maximum
// age (90 days) before application_date, or after it -> REVIEW
import { daysBetween } from '../dates.js';
import type { Rule } from './rule.js';

export const r13: Rule = {
  id: 'R13',
  code: 'ADDRESS_PROOF_STALE',
  outcome: 'REVIEW',
  needs: ['address proof type', 'document_date (usable)'],
  test: ({ app, selected, usable, config }) => {
    const proof = selected.addressProof;
    if (proof?.docType !== 'ELECTRICITY_BILL' && proof?.docType !== 'BANK_STATEMENT')
      return { triggered: false, skipped: 'address proof is not a bill or bank statement' };
    const documentDate = usable(proof, 'document_date');
    if (documentDate === undefined)
      return { triggered: false, skipped: 'document_date is missing or not usable' };
    const ageDays = daysBetween(documentDate, app.applicationDate); // negative = dated after the application
    return {
      triggered: ageDays > config.address_proof_max_age_days || ageDays < 0,
      compared: {
        documentDate,
        applicationDate: app.applicationDate,
        ageDays,
        maxAgeDays: config.address_proof_max_age_days,
      },
    };
  },
};
