// R8: usable aadhaar_last4 differs from the declared aadhaar_last4 -> REJECT
import type { Rule } from './rule.js';

export const r8: Rule = {
  id: 'R8',
  code: 'AADHAAR_MISMATCH',
  outcome: 'REJECT',
  needs: ['Aadhaar card: aadhaar_last4 (usable)'],
  test: ({ app, selected, usable }) => {
    const onCard = usable(selected.aadhaar, 'aadhaar_last4');
    if (onCard === undefined)
      return {
        triggered: false,
        skipped: 'aadhaar_last4 on the Aadhaar card is missing or not usable',
      };
    return {
      triggered: onCard !== app.aadhaarLast4,
      compared: { declared: app.aadhaarLast4, onCard },
    };
  },
};
