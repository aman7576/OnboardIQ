import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REAL_DATA_DIR = fileURLToPath(new URL('../../../csvFiles', import.meta.url));

export interface Editor {
  edit: (file: string, change: (text: string) => string) => void;
  editJsonl: (
    file: string,
    change: (row: Record<string, string>) => Record<string, string>,
  ) => void;
  remove: (file: string) => void;
}

/** Copies the real data pack into a temp folder and lets a test damage the copy (never the original). */
export function makeDataDir(mutate?: (e: Editor) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'onboardiq-data-'));
  cpSync(REAL_DATA_DIR, dir, { recursive: true });
  if (mutate) {
    const edit: Editor['edit'] = (file, change) => {
      const path = join(dir, file);
      const before = readFileSync(path, 'utf8');
      const after = change(before);
      if (after === before) throw new Error(`test fixture edit did not change ${file}`);
      writeFileSync(path, after);
    };
    mutate({
      edit,
      editJsonl: (file, change) =>
        edit(file, (text) =>
          text
            .split('\n')
            .map((l) =>
              l.trim() ? JSON.stringify(change(JSON.parse(l) as Record<string, string>)) : l,
            )
            .join('\n'),
        ),
      remove: (file) => rmSync(join(dir, file)),
    });
  }
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
