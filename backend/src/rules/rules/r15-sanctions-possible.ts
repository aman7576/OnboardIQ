// R15: sanctions screening result is POSSIBLE -> REVIEW
import type { Rule } from './rule.js';

export const r15: Rule = {
  id: 'R15',
  code: 'SANCTIONS_POSSIBLE_MATCH',
  outcome: 'REVIEW',
  needs: ['declared full_name', 'declared dob', 'sanctions list'],
  test: ({ screening }) => ({
    triggered: screening.sanctions.result === 'POSSIBLE',
    compared: { result: screening.sanctions.result, hits: screening.sanctions.hits },
  }),
};
