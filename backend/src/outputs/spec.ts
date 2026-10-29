// The deliverable files of spec sections 6.3 and 6.6, and their exact columns.
import { DECISION_COLUMNS } from '../rules/batch.js';

export const OUTPUT_FILES = {
  decisions: 'decisions_output.csv', // mandatory: mock extraction, evaluation set
  extraction: 'extraction_output.csv', // AI track
  aiDecisions: 'ai_decisions_output.csv', // AI track
  report: 'evaluation_report.md', // AI track
  modelCard: 'model_card.md', // AI track
} as const;

/** Written next to the deliverables: the sample run that is checked against the expected_* columns. */
export const SAMPLE_FILES = { decisions: 'sample/decisions_sample_output.csv' } as const;
export const VALIDATION_FILE = 'validation_report.json';
/** The evidence behind evaluation_report.md as data, read by the AI evaluation screen. */
export const METRICS_FILE = 'evaluation_metrics.json';

export const DECISION_HEADERS = [...DECISION_COLUMNS];
export const EXTRACTION_HEADERS = ['doc_id', 'field_name', 'value', 'confidence'] as const;

const cell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** RFC 4180 style CSV with LF line endings and a trailing newline. Deterministic for equal input. */
export function csvText(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}
