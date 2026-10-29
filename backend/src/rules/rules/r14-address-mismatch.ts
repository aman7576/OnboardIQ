// R14: usable pincode on the address proof differs from the declared pincode -> REVIEW
import type { Rule } from './rule.js';

export const r14: Rule = {
  id: 'R14',
  code: 'ADDRESS_MISMATCH',
  outcome: 'REVIEW',
  needs: ['address proof: pincode (usable)'],
  test: ({ app, selected, usable }) => {
    const onProof = usable(selected.addressProof, 'pincode');
    if (onProof === undefined)
      return { triggered: false, skipped: 'pincode on the address proof is missing or not usable' };
    return { triggered: onProof !== app.pincode, compared: { declared: app.pincode, onProof } };
  },
};
