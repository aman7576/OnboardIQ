// npm run batch -- [--dataset eval|sample] [--applications F --documents F --extraction F] [--output F]
// Reads an applications file, its documents file and a (mock) extraction file, and writes the decisions CSV.
// Needs no database and no .env: data comes from DATA_DIR (default <repo>/csvFiles), output goes to OUTPUT_DIR
// (default <repo>/output). Input files are only read.
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir, outputDir } from '../config/paths.js';
import { datasetFiles } from '../import/manifest.js';
import { runBatch, writeDecisionsCsv } from '../rules/batch.js';

const USAGE = `Usage: npm run batch -- [--dataset eval|sample] [--applications FILE --documents FILE --extraction FILE] [--output FILE]
  Default dataset is eval; it writes OUTPUT_DIR/decisions_output.csv.
  --dataset sample writes decisions_sample_output.csv (so the evaluation deliverable is never overwritten)
  and checks every row against the expected_* columns of the sample file.`;

function main(): number {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'eval' },
      applications: { type: 'string' },
      documents: { type: 'string' },
      extraction: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return (console.log(USAGE), 0);

  const dataset = String(values.dataset).toUpperCase();
  if (dataset !== 'EVAL' && dataset !== 'SAMPLE')
    return (console.error(`Unknown dataset "${values.dataset}".\n${USAGE}`), 1);
  const data = dataDir({ DATA_DIR: process.env.DATA_DIR });
  const names = datasetFiles(dataset);
  const files = {
    applications: resolve(values.applications ?? join(data, names.applications)),
    documents: resolve(values.documents ?? join(data, names.documents)),
    extraction: resolve(values.extraction ?? join(data, names.extractionMock)),
  };
  const output = resolve(
    values.output ??
      join(
        outputDir({ OUTPUT_DIR: process.env.OUTPUT_DIR }),
        dataset === 'EVAL' ? 'decisions_output.csv' : 'decisions_sample_output.csv',
      ),
  );

  let result;
  try {
    result = runBatch(files, data);
  } catch (err) {
    console.error(
      `Cannot read the input files: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (result.failures.length) {
    console.error(
      `${result.failures.length} application(s) could not be evaluated; nothing was written:`,
    );
    for (const f of result.failures.slice(0, 20))
      console.error(`  ${f.applicationId}: ${f.reason}`);
    return 1;
  }

  writeDecisionsCsv(output, result.rows);
  const counts = result.rows.reduce<Record<string, number>>(
    (n, r) => ({ ...n, [r.decision]: (n[r.decision] ?? 0) + 1 }),
    {},
  );
  console.log(`Wrote ${result.rows.length} decisions to ${output}`);
  console.log(
    `  ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  if (result.verification) {
    const { checked, mismatches } = result.verification;
    if (mismatches.length === 0)
      console.log(
        `  Verified against expected_* columns: ${checked}/${checked} applications match`,
      );
    else {
      console.error(
        `  Verification FAILED: ${mismatches.length} difference(s) in ${checked} applications`,
      );
      for (const m of mismatches.slice(0, 20))
        console.error(
          `    ${m.applicationId} ${m.column}: expected "${m.expected}", got "${m.actual}"`,
        );
      return 1;
    }
  }
  return 0;
}

process.exitCode = main();
