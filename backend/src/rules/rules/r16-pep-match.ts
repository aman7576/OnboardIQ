// R16: PEP screening result is MATCH -> REVIEW. (The spec has no rule for a PEP POSSIBLE result.)
import type { Rule } from './rule.js';

export const r16: Rule = {
  id: 'R16',
  code: 'PEP_MATCH',
  outcome: 'REVIEW',
  needs: ['declared full_name', 'declared dob', 'PEP list'],
  test: ({ screening }) => ({
    triggered: screening.pep.result === 'MATCH',
    compared: { result: screening.pep.result, hits: screening.pep.hits },
  }),
};
