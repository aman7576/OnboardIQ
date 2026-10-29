import type { RuleContext } from '../context.js';
import type { ReasonCode, RuleOutcome } from '../types.js';

/** One rule = a few lines: an id, its reason code, its outcome, the fields it needs, and a test. */
export interface Rule {
  id: string;
  code: ReasonCode;
  outcome: 'REVIEW' | 'REJECT';
  needs: string[];
  test(ctx: RuleContext): RuleOutcome;
}
