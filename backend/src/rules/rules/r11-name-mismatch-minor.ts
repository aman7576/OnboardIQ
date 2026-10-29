// R11: name_match_score from the reject threshold up to (not including) the pass threshold -> REVIEW
import { atLeast, below } from '../name.js';
import type { Rule } from './rule.js';

export const r11: Rule = {
  id: 'R11',
  code: 'NAME_MISMATCH_MINOR',
  outcome: 'REVIEW',
  needs: ['name_match_score'],
  test: ({ nameScore, config }) =>
    nameScore === null
      ? { triggered: false, skipped: 'no usable name on the PAN or Aadhaar card' }
      : {
          triggered:
            atLeast(nameScore, config.name_reject_below) &&
            below(nameScore, config.name_match_threshold),
          compared: {
            nameMatchScore: nameScore,
            from: config.name_reject_below,
            below: config.name_match_threshold,
          },
        },
};
