// R1: no usable document of type PAN_CARD, or of type AADHAAR_CARD, or of any address-proof type -> REVIEW
// "Usable" is read as "present": the official expected results show a document whose classification
// confidence is low is still present (R3 reports it), so R1 does not fire for it.
import type { Rule } from './rule.js';

export const r1: Rule = {
  id: 'R1',
  code: 'DOCUMENT_MISSING',
  outcome: 'REVIEW',
  needs: ['doc_type'],
  test: ({ selected }) => {
    const missing = [
      ['PAN_CARD', selected.pan],
      ['AADHAAR_CARD', selected.aadhaar],
      ['ADDRESS_PROOF', selected.addressProof],
    ]
      .filter(([, doc]) => !doc)
      .map(([name]) => name);
    return { triggered: missing.length > 0, compared: { missing } };
  },
};
