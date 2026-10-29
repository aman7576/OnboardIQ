// Import orchestration. One database transaction per target: plan every table (read-only),
// and write only if no row was rejected; otherwise nothing is committed.
import type { PrismaClient } from '@prisma/client';
import { planApplications } from './applications.js';
import { planDocuments } from './documents.js';
import { planMockExtraction, planTruth } from './extractions.js';
import { datasetFiles, type DatasetName } from './manifest.js';
import type { Rejection } from './read.js';
import { planReference } from './reference.js';
import type { Step, TableCount, Tx } from './step.js';

export type ImportTarget = 'REFERENCE' | DatasetName;

export interface ImportResult {
  target: ImportTarget;
  committed: boolean;
  tables: TableCount[];
  rejections: Rejection[];
  warnings: string[];
  files: { file: string; sha256: string; rows: number }[];
}

export interface ImportOptions {
  dataDir: string;
  /** Runs after all writes, before commit. Tests use it to simulate a late failure. */
  beforeCommit?: (tx: Tx) => Promise<void>;
}

class Rejected extends Error {
  constructor(readonly result: ImportResult) {
    super('import rejected');
  }
}

async function planDataset(tx: Tx, dir: string, dataset: DatasetName): Promise<Step[]> {
  const files = datasetFiles(dataset);
  const apps = await planApplications(tx, dir, files.applications, dataset);
  const docs = await planDocuments(tx, dir, files, dataset, apps.knownApplications);
  const steps = [
    ...apps.steps,
    docs.step,
    await planMockExtraction(tx, dir, files.extractionMock, docs.knownDocs),
  ];
  if (files.truth) steps.push(await planTruth(tx, dir, files.truth, docs.knownDocs));
  return steps;
}

export async function runImport(
  prisma: PrismaClient,
  target: ImportTarget,
  opts: ImportOptions,
): Promise<ImportResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const steps =
          target === 'REFERENCE'
            ? await planReference(tx, opts.dataDir)
            : await planDataset(tx, opts.dataDir, target);
        const result: ImportResult = {
          target,
          committed: true,
          tables: steps.map((s) => s.count),
          rejections: steps.flatMap((s) => s.rejections),
          warnings: steps.flatMap((s) => s.warnings),
          files: steps.flatMap((s) => s.sources),
        };
        if (result.rejections.length > 0) {
          // Validate-before-commit: report what was found, write nothing.
          throw new Rejected({
            ...result,
            committed: false,
            tables: result.tables.map((t) => ({ ...t, inserted: 0, skipped: 0 })),
          });
        }
        for (const step of steps) await step.write(tx);
        await tx.importRun.create({
          data: {
            dataset: target,
            files: result.files,
            summary: { tables: result.tables, warnings: result.warnings },
          },
        });
        if (opts.beforeCommit) await opts.beforeCommit(tx);
        return result;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof Rejected) return err.result;
    throw err;
  }
}

export function formatResult(r: ImportResult): string {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const lines = [
    `${r.target}: ${r.committed ? 'COMMITTED' : 'REJECTED - nothing written'}`,
    `  ${pad('table', 22)}${pad('read', 7)}${pad('inserted', 10)}${pad('skipped', 9)}rejected`,
    ...r.tables.map(
      (t) =>
        `  ${pad(t.table, 22)}${pad(t.read, 7)}${pad(t.inserted, 10)}${pad(t.skipped, 9)}${t.rejected}`,
    ),
    ...r.warnings.map((w) => `  warning: ${w}`),
    ...r.rejections
      .slice(0, 25)
      .map((x) => `  rejected ${x.file}${x.line ? `:${x.line}` : ''} - ${x.reason}`),
  ];
  if (r.rejections.length > 25) lines.push(`  ... ${r.rejections.length - 25} more rejections`);
  return lines.join('\n');
}
