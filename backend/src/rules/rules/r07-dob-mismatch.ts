// R7: usable dob on the PAN card or the Aadhaar card differs from the declared dob -> REJECT
import type { Rule } from './rule.js';

export const r7: Rule = {
  id: 'R7',
  code: 'DOB_MISMATCH',
  outcome: 'REJECT',
  needs: ['PAN card: dob (usable)', 'Aadhaar card: dob (usable)'],
  test: ({ app, selected, usable }) => {
    const seen = [
      { source: 'PAN_CARD', dob: usable(selected.pan, 'dob') },
      { source: 'AADHAAR_CARD', dob: usable(selected.aadhaar, 'dob') },
    ].filter((x): x is { source: string; dob: string } => x.dob !== undefined);
    if (seen.length === 0)
      return { triggered: false, skipped: 'no usable dob on the PAN or Aadhaar card' };
    return {
      triggered: seen.some((x) => x.dob !== app.dob),
      compared: { declared: app.dob, documents: seen },
    };
  },
};
