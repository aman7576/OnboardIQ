// R9: name_match_score below the reject threshold (0.75) -> REJECT
import { below } from '../name.js';
import type { Rule } from './rule.js';

export const r9: Rule = {
  id: 'R9',
  code: 'NAME_MISMATCH',
  outcome: 'REJECT',
  needs: ['declared full_name', 'PAN card: name (usable)', 'Aadhaar card: name (usable)'],
  test: ({ nameScore, nameComparisons, config }) =>
    nameScore === null
      ? { triggered: false, skipped: 'no usable name on the PAN or Aadhaar card' }
      : {
          triggered: below(nameScore, config.name_reject_below),
          compared: {
            nameMatchScore: nameScore,
            rejectBelow: config.name_reject_below,
            comparisons: nameComparisons,
          },
        },
};
