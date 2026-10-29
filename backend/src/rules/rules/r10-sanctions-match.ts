// R10: sanctions screening result is MATCH -> REJECT
import type { Rule } from './rule.js';

export const r10: Rule = {
  id: 'R10',
  code: 'SANCTIONS_MATCH',
  outcome: 'REJECT',
  needs: ['declared full_name', 'declared dob', 'sanctions list'],
  test: ({ screening }) => ({
    triggered: screening.sanctions.result === 'MATCH',
    compared: { result: screening.sanctions.result, hits: screening.sanctions.hits },
  }),
};
