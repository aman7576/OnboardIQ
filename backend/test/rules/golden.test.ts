import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/rules/evaluate.js';
import { loadCases, loadReference } from '../../src/rules/file-data.js';
import { formatScore } from '../../src/rules/name.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';

const reference = loadReference(REAL_DATA_DIR);
const run = (c: ReturnType<typeof loadCases>[number]) =>
  evaluate(
    c.application,
    c.documents,
    reference.config,
    reference.watchlists,
    reference.existingCustomers,
  );

describe('golden: the 60 sample applications match the expected columns', () => {
  const cases = loadCases(REAL_DATA_DIR, 'SAMPLE');

  it('has all 60 applications with expectations', () => {
    expect(cases).toHaveLength(60);
    expect(cases.every((c) => c.expected)).toBe(true);
  });

  it.each(cases.map((c) => [c.application.applicationId, c] as const))('%s', (_id, c) => {
    const result = run(c);
    const e = c.expected as Record<string, string>;
    expect({
      decision: result.decision,
      reason_codes: result.reasonCodes.join('|'),
      name_match_score: formatScore(result.nameMatchScore),
      risk_category: result.riskCategory ?? '',
      rekyc_due_date: result.rekycDueDate ?? '',
    }).toEqual({
      decision: e.expected_decision,
      reason_codes: e.expected_reason_codes,
      name_match_score: e.expected_name_match_score,
      risk_category: e.expected_risk_category,
      rekyc_due_date: e.expected_rekyc_due_date,
    });
  });
});
