// Batch decisions (spec FR-11): applications file + documents file + extraction file -> one decision row
// per application, using the same pure engine as the API. Nothing here touches a database.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluate } from './evaluate.js';
import { loadCasesFromFiles, loadReference, type CaseFiles } from './file-data.js';
import { formatScore } from './name.js';

/** Columns of /output/decisions_output.csv, in specification order. */
export const DECISION_COLUMNS = [
  'application_id',
  'decision',
  'reason_codes',
  'name_match_score',
  'risk_category',
  'rekyc_due_date',
] as const;

export type DecisionRow = Record<(typeof DECISION_COLUMNS)[number], string>;

export interface BatchResult {
  rows: DecisionRow[];
  /** Applications that could not be evaluated (nothing is written when there are any). */
  failures: { applicationId: string; reason: string }[];
  /** Only for files that carry the expected_* columns (the sample): rows that differ from them. */
  verification: {
    checked: number;
    mismatches: { applicationId: string; column: string; expected: string; actual: string }[];
  } | null;
}

export function runBatch(files: CaseFiles, referenceDir: string): BatchResult {
  const reference = loadReference(referenceDir);
  const rows: DecisionRow[] = [];
  const failures: BatchResult['failures'] = [];
  const mismatches: NonNullable<BatchResult['verification']>['mismatches'] = [];
  let checked = 0;

  for (const c of loadCasesFromFiles(files)) {
    const id = c.application.applicationId;
    try {
      const e = evaluate(
        c.application,
        c.documents,
        reference.config,
        reference.watchlists,
        reference.existingCustomers,
      );
      const row: DecisionRow = {
        application_id: id,
        decision: e.decision,
        reason_codes: e.reasonCodes.join('|'), // all triggered codes in rule order
        name_match_score: formatScore(e.nameMatchScore), // 4 decimals, empty when not computable
        risk_category: e.riskCategory ?? '', // empty for REJECT
        rekyc_due_date: e.rekycDueDate ?? '', // empty for REJECT
      };
      rows.push(row);
      if (c.expected) {
        checked++;
        const expected = {
          decision: c.expected.expected_decision,
          reason_codes: c.expected.expected_reason_codes,
          name_match_score: c.expected.expected_name_match_score,
          risk_category: c.expected.expected_risk_category,
          rekyc_due_date: c.expected.expected_rekyc_due_date,
        };
        for (const [column, want] of Object.entries(expected))
          if (row[column as keyof DecisionRow] !== want)
            mismatches.push({
              applicationId: id,
              column,
              expected: want ?? '',
              actual: row[column as keyof DecisionRow],
            });
      }
    } catch (err) {
      failures.push({
        applicationId: id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { rows, failures, verification: checked > 0 ? { checked, mismatches } : null };
}

const cell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(rows: DecisionRow[]): string {
  return (
    [
      DECISION_COLUMNS.join(','),
      ...rows.map((r) => DECISION_COLUMNS.map((c) => cell(r[c])).join(',')),
    ].join('\n') + '\n'
  );
}

export function writeDecisionsCsv(path: string, rows: DecisionRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(rows), 'utf8');
}
