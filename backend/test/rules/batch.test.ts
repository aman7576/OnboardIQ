import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { datasetFiles } from '../../src/import/manifest.js';
import { DECISION_COLUMNS, runBatch, toCsv } from '../../src/rules/batch.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';

const files = (dataset: 'SAMPLE' | 'EVAL') => {
  const n = datasetFiles(dataset);
  return {
    applications: join(REAL_DATA_DIR, n.applications),
    documents: join(REAL_DATA_DIR, n.documents),
    extraction: join(REAL_DATA_DIR, n.extractionMock),
  };
};
const parseCsv = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((l) => l.split(','));

describe('batch decisions (FR-11)', () => {
  it('on the sample files with the mock extraction reproduces every expected column (60/60)', () => {
    const result = runBatch(files('SAMPLE'), REAL_DATA_DIR);
    expect(result.rows).toHaveLength(60);
    expect(result.failures).toEqual([]);
    expect(result.verification).toEqual({ checked: 60, mismatches: [] });
  });

  it('writes one row per evaluation application in the specified column order', () => {
    const { rows, verification } = runBatch(files('EVAL'), REAL_DATA_DIR);
    expect(rows).toHaveLength(100);
    expect(verification).toBeNull(); // the evaluation file has no expected columns
    const csv = parseCsv(toCsv(rows));
    expect(csv[0]).toEqual([
      'application_id',
      'decision',
      'reason_codes',
      'name_match_score',
      'risk_category',
      'rekyc_due_date',
    ]);
    expect(csv[0]).toEqual([...DECISION_COLUMNS]);
    expect(csv).toHaveLength(101);
    expect(new Set(csv.slice(1).map((r) => r[0])).size).toBe(100);
  });

  it('formats cells as specified: 4-decimal scores, | between codes, empty risk and re-KYC for REJECT', () => {
    const { rows } = runBatch(files('EVAL'), REAL_DATA_DIR);
    for (const r of rows) {
      expect(['APPROVE', 'REVIEW', 'REJECT']).toContain(r.decision);
      expect(r.name_match_score === '' || /^[01]\.\d{4}$/.test(r.name_match_score)).toBe(true);
      expect(r.rekyc_due_date === '' || /^\d{4}-\d{2}-\d{2}$/.test(r.rekyc_due_date)).toBe(true);
      if (r.decision === 'REJECT') expect([r.risk_category, r.rekyc_due_date]).toEqual(['', '']);
      else expect(['LOW', 'MEDIUM', 'HIGH']).toContain(r.risk_category);
      if (r.decision === 'APPROVE') expect(r.reason_codes).toBe('');
    }
    expect(rows.some((r) => r.reason_codes.includes('|'))).toBe(true);
  });

  it('reports applications it cannot evaluate instead of guessing (unknown occupation)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-'));
    const bad = readFileSync(files('EVAL').applications, 'utf8').replaceAll(
      ',SELF_EMPLOYED,',
      ',ASTRONAUT,',
    );
    const path = join(dir, 'apps.csv');
    writeFileSync(path, bad);
    const result = runBatch({ ...files('EVAL'), applications: path }, REAL_DATA_DIR);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]?.reason).toMatch(/unknown occupation_code ASTRONAUT/);
  });
});

describe('npm run batch (command line)', () => {
  const cli = fileURLToPath(new URL('../../src/cli/batch.ts', import.meta.url));
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('npx', ['tsx', cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const snapshot = () =>
    readdirSync(REAL_DATA_DIR)
      .sort()
      .map(
        (f) =>
          `${f}:${createHash('sha256')
            .update(readFileSync(join(REAL_DATA_DIR, f)))
            .digest('hex')}`,
      );

  it('writes decisions_output.csv for the evaluation set, never touching the input files', () => {
    const out = mkdtempSync(join(tmpdir(), 'batch-out-'));
    const before = snapshot();
    const res = run([], { OUTPUT_DIR: out });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Wrote 100 decisions');
    const csv = parseCsv(readFileSync(join(out, 'decisions_output.csv'), 'utf8'));
    expect(csv).toHaveLength(101);
    expect(snapshot()).toEqual(before);
  });

  it('on the sample dataset verifies against the expected columns and uses a different file name', () => {
    const out = mkdtempSync(join(tmpdir(), 'batch-out-'));
    const res = run(['--dataset', 'sample'], { OUTPUT_DIR: out });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('60/60 applications match');
    expect(readdirSync(out)).toEqual(['decisions_sample_output.csv']);
  });

  it('accepts explicit file paths and an output path', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'batch-out-')), 'custom.csv');
    const f = files('EVAL');
    const res = run([
      '--applications',
      f.applications,
      '--documents',
      f.documents,
      '--extraction',
      f.extraction,
      '--output',
      out,
    ]);
    expect(res.status).toBe(0);
    expect(readFileSync(out, 'utf8').split('\n')[0]).toBe(
      'application_id,decision,reason_codes,name_match_score,risk_category,rekyc_due_date',
    );
  });

  it('fails clearly, writing nothing, when an input file is missing', () => {
    const out = mkdtempSync(join(tmpdir(), 'batch-out-'));
    const res = run(['--applications', '/nonexistent/apps.csv'], { OUTPUT_DIR: out });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Cannot read the input files');
    expect(readdirSync(out)).toEqual([]);
  });

  it('rejects an unknown dataset', () => {
    expect(run(['--dataset', 'prod']).status).toBe(1);
  });
});
