import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { rowHash, type Rejection, type SourceFile } from './read.js';

export interface ValidRow<T> {
  line: number;
  key: string;
  hash: string;
  data: T;
}

/** Validates every row of a file, rejecting schema errors and repeated keys (first wins). */
export function validateRows<S extends z.ZodType>(
  source: SourceFile,
  schema: S,
  key: (data: z.output<S>) => string,
): { rows: ValidRow<z.output<S>>[]; rejections: Rejection[] } {
  const rows: ValidRow<z.output<S>>[] = [];
  const rejections: Rejection[] = [...source.rejections];
  const firstLine = new Map<string, number>();

  for (const { line, values } of source.rows) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
      rejections.push({ file: source.file, line, reason });
      continue;
    }
    const k = key(parsed.data);
    const seen = firstLine.get(k);
    if (seen !== undefined) {
      rejections.push({
        file: source.file,
        line,
        reason: `duplicate key ${k} (first seen at line ${seen})`,
      });
      continue;
    }
    firstLine.set(k, line);
    rows.push({ line, key: k, hash: rowHash(values), data: parsed.data });
  }
  return { rows, rejections };
}

export interface Existing {
  hash: string | null;
  dataset?: string;
}

/**
 * Idempotency: a row whose key is new is inserted; same key + same hash (+ same dataset) is
 * skipped; anything else is a conflict and rejected, never silently overwritten.
 */
export function planAgainst<R extends { line: number; key: string; hash: string }>(
  file: string,
  rows: R[],
  existing: Map<string, Existing>,
  dataset?: string,
): { insert: R[]; skipped: number; rejections: Rejection[] } {
  const insert: R[] = [];
  const rejections: Rejection[] = [];
  let skipped = 0;
  for (const row of rows) {
    const found = existing.get(row.key);
    if (!found) insert.push(row);
    else if (dataset && found.dataset && found.dataset !== dataset)
      rejections.push({
        file,
        line: row.line,
        reason: `${row.key} already exists in dataset ${found.dataset}`,
      });
    else if (found.hash === row.hash) skipped++;
    else
      rejections.push({
        file,
        line: row.line,
        reason: `${row.key} already imported with different content`,
      });
  }
  return { insert, skipped, rejections };
}

/** Deterministic UUID (version-5 layout) so re-seeding produces the same ids. */
export function stableUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  const variant = ((parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
