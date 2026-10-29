import type { Prisma } from '@prisma/client';
import type { Rejection, SourceFile } from './read.js';

export type Tx = Prisma.TransactionClient;

// A type alias (not an interface) so it is assignable to Prisma's JSON input type.
export type TableCount = {
  table: string;
  file: string;
  read: number;
  inserted: number;
  skipped: number;
  rejected: number;
};

/** One table's import: counts and problems found while planning, plus the write to run if all is clean. */
export interface Step {
  count: TableCount;
  rejections: Rejection[];
  warnings: string[];
  sources: { file: string; sha256: string; rows: number }[];
  write: (tx: Tx) => Promise<void>;
}

export function makeStep(
  table: string,
  srcs: SourceFile | SourceFile[],
  plan: { inserted: number; skipped: number; rejections: Rejection[] },
  write: (tx: Tx) => Promise<void>,
): Step {
  const files = Array.isArray(srcs) ? srcs : [srcs];
  return {
    count: {
      table,
      file: files.map((f) => f.file).join(' + '),
      read: files[0]?.dataRows ?? 0, // rows of the primary file
      inserted: plan.inserted,
      skipped: plan.skipped,
      rejected: plan.rejections.length,
    },
    rejections: plan.rejections,
    warnings: files.flatMap((f) => f.warnings),
    sources: files
      .filter((f) => f.sha256)
      .map((f) => ({ file: f.file, sha256: f.sha256, rows: f.dataRows })),
    write,
  };
}

/** Foreign-key check against keys known in this run or already in the database. */
export function requireKnown<T extends { line: number }>(
  file: string,
  rows: T[],
  ref: (row: T) => string,
  known: (key: string) => string | true | undefined,
  label: string,
): { kept: T[]; rejections: Rejection[] } {
  const kept: T[] = [];
  const rejections: Rejection[] = [];
  for (const row of rows) {
    const verdict = known(ref(row));
    if (verdict === true) kept.push(row);
    else
      rejections.push({
        file,
        line: row.line,
        reason: verdict ?? `${label} ${ref(row)} does not exist`,
      });
  }
  return { kept, rejections };
}
