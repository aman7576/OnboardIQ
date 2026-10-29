// npm run outputs:repeat: runs the whole pipeline twice, each time on a brand-new empty database, validates both
// runs, and compares every generated file byte for byte (SHA-256). Nothing is written to the output folder.
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dataDir, outputDir } from '../config/paths.js';
import { loadConfig } from '../config/load.js';
import { METRICS_FILE, OUTPUT_FILES, SAMPLE_FILES, VALIDATION_FILE } from '../outputs/spec.js';
import { printResult, runPipeline } from './outputs.js';

const FILES = [
  ...Object.values(OUTPUT_FILES),
  SAMPLE_FILES.decisions,
  METRICS_FILE,
  VALIDATION_FILE,
];
const hash = (path: string): string =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'MISSING';

async function main(): Promise<number> {
  const data = dataDir({ DATA_DIR: process.env.DATA_DIR });
  const databaseUrl = loadConfig().DATABASE_URL;
  const runs = [
    mkdtempSync(join(tmpdir(), 'onboardiq-run1-')),
    mkdtempSync(join(tmpdir(), 'onboardiq-run2-')),
  ];
  let ok = true;
  try {
    for (const [i, out] of runs.entries()) {
      console.log(
        `--- run ${i + 1}: new empty database -> migrate -> import -> generate -> validate`,
      );
      const { summary, checks } = await runPipeline({
        source: 'db',
        fresh: true,
        out,
        data,
        databaseUrl,
      });
      printResult(summary, checks);
      ok &&= checks.every((c) => c.ok);
    }
    console.log('\n--- comparison of run 1 and run 2 (SHA-256 of every file)');
    const committed = resolve(outputDir({ OUTPUT_DIR: process.env.OUTPUT_DIR }));
    for (const file of FILES) {
      const [a, b] = runs.map((r) => hash(join(r, file)));
      const same = a === b && a !== 'MISSING';
      ok &&= same;
      const existing = hash(join(committed, file));
      console.log(
        `${same ? 'IDENTICAL' : 'DIFFERENT'}  ${file.padEnd(34)} ${(a ?? '').slice(0, 16)}...  ${existing === a ? '(equals the file in output/)' : existing === 'MISSING' ? '(no file in output/ yet)' : '(output/ differs: re-run `npm run outputs`)'}`,
      );
    }
    console.log(
      ok
        ? '\nRepeatable: both runs validated and every file is byte-identical.'
        : '\nNOT repeatable or invalid: see the lines above.',
    );
  } finally {
    for (const r of runs) rmSync(r, { recursive: true, force: true });
  }
  return ok ? 0 : 1;
}

process.exitCode = await main();
