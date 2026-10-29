// npm run outputs [-- --fresh-db] [--source db|files] [--output DIR]
// Writes the five deliverables (and the sample check) and validates them.
//   default      read the already-imported database (run `npm run db:seed` first)
//   --fresh-db   create an empty scratch database, migrate and import, run, and drop it: repeatable from clean
//   --source files   straight from the supplied files, no database
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir, outputDir } from '../config/paths.js';
import { createPrisma } from '../db/prisma.js';
import { loadConfig } from '../config/load.js';
import { withFreshDatabase } from '../outputs/fresh-db.js';
import { generateOutputs, type GenerationSummary } from '../outputs/generate.js';
import { VALIDATION_FILE } from '../outputs/spec.js';
import { validateOutputs, type Check } from '../outputs/validate.js';

export async function runPipeline(opts: {
  source: 'db' | 'files';
  fresh: boolean;
  out: string;
  data: string;
  databaseUrl?: string;
}): Promise<{ summary: GenerationSummary; checks: Check[] }> {
  let summary: GenerationSummary;
  if (opts.source === 'files') {
    summary = await generateOutputs({ dataDir: opts.data, outputDir: opts.out });
  } else if (opts.fresh) {
    if (!opts.databaseUrl) throw new Error('DATABASE_URL is needed to create the scratch database');
    summary = await withFreshDatabase(opts.databaseUrl, opts.data, (prisma) =>
      generateOutputs({ dataDir: opts.data, outputDir: opts.out, prisma }),
    );
  } else {
    if (!opts.databaseUrl) throw new Error('DATABASE_URL is not set');
    const prisma = createPrisma(opts.databaseUrl);
    try {
      summary = await generateOutputs({ dataDir: opts.data, outputDir: opts.out, prisma });
    } finally {
      await prisma.$disconnect();
    }
  }
  const checks = validateOutputs(opts.out, opts.data);
  // Deterministic: no timestamps, only what was checked and the result.
  writeFileSync(
    join(opts.out, VALIDATION_FILE),
    JSON.stringify(
      { source: summary.source, allPassed: checks.every((c) => c.ok), checks },
      null,
      2,
    ) + '\n',
  );
  return { summary, checks };
}

export function printResult(summary: GenerationSummary, checks: Check[]): void {
  console.log(
    `Source: ${summary.source}. Rows: decisions ${summary.rows.decisions}, extraction ${summary.rows.extraction}, ai decisions ${summary.rows.aiDecisions}`,
  );
  if (summary.databaseVsFilesIdentical !== null)
    console.log(
      `Decisions from the database are ${summary.databaseVsFilesIdentical ? 'identical to' : 'DIFFERENT from'} decisions computed from the files`,
    );
  for (const f of summary.files)
    console.log(
      `  ${f.file.padEnd(34)} ${String(f.bytes).padStart(7)} bytes  sha256 ${f.sha256.slice(0, 16)}...`,
    );
  const failed = checks.filter((c) => !c.ok);
  console.log(`Validation: ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const c of failed) console.error(`  FAIL ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'db' },
      'fresh-db': { type: 'boolean', default: false },
      output: { type: 'string' },
    },
  });
  const source = values.source === 'files' ? 'files' : 'db';
  const data = dataDir({ DATA_DIR: process.env.DATA_DIR });
  const out = resolve(values.output ?? outputDir({ OUTPUT_DIR: process.env.OUTPUT_DIR }));
  const databaseUrl = source === 'db' ? loadConfig().DATABASE_URL : undefined;
  const { summary, checks } = await runPipeline({
    source,
    fresh: values['fresh-db'] === true,
    out,
    data,
    ...(databaseUrl ? { databaseUrl } : {}),
  });
  printResult(summary, checks);
  return checks.every((c) => c.ok) && summary.databaseVsFilesIdentical !== false ? 0 : 1;
}

if (process.argv[1]?.endsWith('outputs.ts')) process.exitCode = await main();
