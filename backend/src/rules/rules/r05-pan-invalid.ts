// R5: declared pan_number does not match the pattern, or its 4th character is not the holder type -> REJECT
import type { Rule } from './rule.js';

export const r5: Rule = {
  id: 'R5',
  code: 'PAN_INVALID',
  outcome: 'REJECT',
  needs: ['declared pan_number'],
  test: ({ app, config }) => {
    const formatOk = new RegExp(config.pan_pattern).test(app.panNumber);
    const holderType = app.panNumber.charAt(3);
    return {
      triggered: !formatOk || holderType !== config.pan_holder_type_char,
      compared: {
        pan: app.panNumber,
        pattern: config.pan_pattern,
        formatOk,
        holderType,
        expectedHolderType: config.pan_holder_type_char,
      },
    };
  },
};
