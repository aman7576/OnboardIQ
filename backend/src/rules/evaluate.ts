// The rules engine. Pure and deterministic: same input, same output, no side effects.
// "AI proposes, rules decide": extraction only supplies document types and fields with confidence.
import { buildContext } from './context.js';
import { riskCategory, rekycDueDate } from './risk.js';
import { RULES } from './rules/index.js';
import type {
  ApplicationInput,
  ClassifiedDocument,
  Decision,
  EngineConfig,
  Evaluation,
  ExistingCustomer,
  ReasonCode,
  TraceEntry,
  Watchlists,
} from './types.js';

export function evaluate(
  application: ApplicationInput,
  documents: ClassifiedDocument[],
  config: EngineConfig,
  watchlists: Watchlists,
  existingCustomers: readonly ExistingCustomer[],
): Evaluation {
  const ctx = buildContext(application, documents, config, watchlists, existingCustomers);

  // All rules run (no short-circuit); a rule whose field is not usable reports "skipped".
  const trace: TraceEntry[] = RULES.map((rule) => {
    const result = rule.test(ctx);
    return {
      rule: rule.id,
      code: rule.code,
      outcome: rule.outcome,
      status: result.skipped ? 'SKIPPED' : result.triggered ? 'TRIGGERED' : 'PASSED',
      ...(result.skipped ? { skippedBecause: result.skipped } : {}),
      ...(result.compared ? { compared: result.compared } : {}),
    };
  });

  const triggered = trace.filter((t) => t.status === 'TRIGGERED');
  const reasonCodes: ReasonCode[] = triggered.map((t) => t.code);
  // REJECT if any rejecting rule (R4-R10) triggered; otherwise REVIEW if any other rule did; else APPROVE.
  const decision: Decision = triggered.some((t) => t.outcome === 'REJECT')
    ? 'REJECT'
    : triggered.length > 0
      ? 'REVIEW'
      : 'APPROVE';

  // Risk and re-KYC date are computed for APPROVE and REVIEW only.
  const risk =
    decision === 'REJECT' ? null : riskCategory(application, new Set(reasonCodes), config);
  return {
    decision,
    reasonCodes,
    nameMatchScore: ctx.nameScore,
    riskCategory: risk,
    rekycDueDate: risk ? rekycDueDate(application.applicationDate, risk, config) : null,
    trace,
    screening: ctx.screening,
  };
}
