// R6: usable pan_number on the PAN card differs from the declared pan_number -> REJECT
import type { Rule } from './rule.js';

export const r6: Rule = {
  id: 'R6',
  code: 'PAN_MISMATCH',
  outcome: 'REJECT',
  needs: ['PAN card: pan_number (usable)'],
  test: ({ app, selected, usable }) => {
    const onCard = usable(selected.pan, 'pan_number');
    if (onCard === undefined)
      return { triggered: false, skipped: 'pan_number on the PAN card is missing or not usable' };
    return { triggered: onCard !== app.panNumber, compared: { declared: app.panNumber, onCard } };
  },
};
