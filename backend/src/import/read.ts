import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

export interface Rejection {
  file: string;
  line: number | null; // null = whole-file problem
  reason: string;
}

export interface SourceRow {
  line: number;
  values: Record<string, string>;
}

export interface SourceFile {
  file: string;
  sha256: string;
  rows: SourceRow[];
  rejections: Rejection[];
  warnings: string[];
  columns: string[];
  dataRows: number; // data lines seen, valid or not
}

export const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

/** Order-independent fingerprint of a source row, used for idempotent re-import. */
export function rowHash(values: Record<string, string>): string {
  return sha256(JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b))));
}

// Read-only: files are opened for reading and never written.
function readText(dir: string, file: string): { text: string; sha: string } | Rejection {
  const path = join(dir, file);
  if (!existsSync(path)) return { file, line: null, reason: 'file not found' };
  const bytes = readFileSync(path);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ''), sha: sha256(bytes) };
  } catch {
    return { file, line: null, reason: 'file is not valid UTF-8' };
  }
}

const empty = (file: string, rejection: Rejection): SourceFile => ({
  file,
  sha256: '',
  rows: [],
  rejections: [rejection],
  warnings: [],
  columns: [],
  dataRows: 0,
});

export function readCsv(
  dir: string,
  file: string,
  required: readonly string[],
  optional: readonly string[] = [],
): SourceFile {
  const read = readText(dir, file);
  if ('reason' in read) return empty(file, read);

  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(read.text, {
      relax_column_count: true,
      skip_empty_lines: true,
      info: true,
    }) as unknown as typeof records;
  } catch (err) {
    return empty(file, { file, line: null, reason: `CSV parse error: ${(err as Error).message}` });
  }
  const [head, ...body] = records;
  const header = head?.record ?? [];
  const out: SourceFile = {
    file,
    sha256: read.sha,
    rows: [],
    rejections: [],
    warnings: [],
    columns: header,
    dataRows: body.length,
  };

  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) {
    out.rejections.push({
      file,
      line: 1,
      reason: `missing required column(s): ${missing.join(', ')}`,
    });
    return out;
  }
  const unknown = header.filter((c) => !required.includes(c) && !optional.includes(c));
  if (unknown.length)
    out.warnings.push(`${file}: ignored unknown column(s): ${unknown.join(', ')}`);

  for (const { record, info } of body) {
    if (record.length !== header.length) {
      out.rejections.push({
        file,
        line: info.lines,
        reason: `expected ${header.length} values, found ${record.length}`,
      });
      continue;
    }
    const values: Record<string, string> = {};
    header.forEach((col, i) => {
      if (required.includes(col) || optional.includes(col)) values[col] = record[i] ?? '';
    });
    out.rows.push({ line: info.lines, values });
  }
  return out;
}

export function readJsonl(dir: string, file: string, required: readonly string[]): SourceFile {
  const read = readText(dir, file);
  if ('reason' in read) return empty(file, read);
  const out: SourceFile = {
    file,
    sha256: read.sha,
    rows: [],
    rejections: [],
    warnings: [],
    columns: [...required],
    dataRows: 0,
  };

  read.text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    out.dataRows++;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      out.rejections.push({ file, line, reason: 'invalid JSON' });
      return;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      out.rejections.push({ file, line, reason: 'line is not a JSON object' });
      return;
    }
    const entries = obj as Record<string, unknown>;
    const bad = required.filter((k) => typeof entries[k] !== 'string');
    if (bad.length) {
      out.rejections.push({
        file,
        line,
        reason: `missing or non-string key(s): ${bad.join(', ')}`,
      });
      return;
    }
    out.rows.push({
      line,
      values: Object.fromEntries(required.map((k) => [k, entries[k] as string])),
    });
  });
  return out;
}

export function readJson(
  dir: string,
  file: string,
): { file: string; sha256: string; value: unknown } | Rejection {
  const read = readText(dir, file);
  if ('reason' in read) return read;
  try {
    return { file, sha256: read.sha, value: JSON.parse(read.text) };
  } catch {
    return { file, line: null, reason: 'invalid JSON' };
  }
}
