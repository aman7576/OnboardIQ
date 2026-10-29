import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateOutputs } from '../../src/outputs/generate.js';
import { withFreshDatabase } from '../../src/outputs/fresh-db.js';
import { OUTPUT_FILES, SAMPLE_FILES } from '../../src/outputs/spec.js';
import { validateOutputs } from '../../src/outputs/validate.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const failing = (dir: string) => validateOutputs(dir, REAL_DATA_DIR).filter((c) => !c.ok);

let good: string; // a pristine, validated output folder
beforeAll(async () => {
  good = tmp('onboardiq-good-');
  await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: good });
}, 60_000);

/** A copy of the good outputs with one file changed. */
function damaged(file: string, change: (text: string) => string): string {
  const dir = tmp('onboardiq-bad-');
  cpSync(good, dir, { recursive: true });
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`fixture change did nothing to ${file}`);
  writeFileSync(path, after);
  return dir;
}
const lines = (t: string) => t.split('\n');
const editRow = (t: string, index: number, f: (cells: string[]) => string[]) => {
  const l = lines(t);
  l[index] = f((l[index] as string).split(',')).join(',');
  return l.join('\n');
};

describe('generated deliverables', () => {
  it('pass every validation check', () => {
    const checks = validateOutputs(good, REAL_DATA_DIR);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(30);
  });

  it('have the required files, headers and row counts', () => {
    expect(readdirSync(good).sort()).toEqual(
      [
        ...Object.values(OUTPUT_FILES),
        'sample',
        'validation_report.json',
        'evaluation_metrics.json',
      ]
        .sort()
        .filter((f) => existsSync(join(good, f))),
    );
    expect(lines(readFileSync(join(good, OUTPUT_FILES.decisions), 'utf8'))[0]).toBe(
      'application_id,decision,reason_codes,name_match_score,risk_category,rekyc_due_date',
    );
    expect(lines(readFileSync(join(good, OUTPUT_FILES.extraction), 'utf8'))[0]).toBe(
      'doc_id,field_name,value,confidence',
    );
    expect(
      lines(readFileSync(join(good, OUTPUT_FILES.decisions), 'utf8')).filter(Boolean),
    ).toHaveLength(101); // header + 100 evaluation applications
    expect(
      lines(readFileSync(join(good, OUTPUT_FILES.aiDecisions), 'utf8')).filter(Boolean),
    ).toHaveLength(101);
  });

  it('use the specified formats: 4-decimal scores, 2-decimal confidences, YYYY-MM-DD dates, empty cells for REJECT', () => {
    const decisions = lines(readFileSync(join(good, OUTPUT_FILES.decisions), 'utf8'))
      .filter(Boolean)
      .slice(1)
      .map((l) => l.split(','));
    for (const [, decision, , score, risk, rekyc] of decisions) {
      expect(score).toMatch(/^[01]\.\d{4}$/);
      if (decision === 'REJECT') expect([risk, rekyc]).toEqual(['', '']);
      else expect(rekyc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const row of lines(readFileSync(join(good, OUTPUT_FILES.extraction), 'utf8'))
      .filter(Boolean)
      .slice(1))
      expect(row).toMatch(/,(0\.\d{2}|1\.00)$/);
  });

  it('reproduce the 60 expected sample decisions with the mock extraction, and report the evaluation evidence separately', () => {
    expect(
      validateOutputs(good, REAL_DATA_DIR).find((c) => c.name.startsWith('sample mock output')),
    ).toMatchObject({ ok: true });
    const report = readFileSync(join(good, OUTPUT_FILES.report), 'utf8');
    expect(report).toContain('has **no truth and no expected decisions**');
    expect(report).toContain('60/60');
    expect(report).not.toMatch(/NaN|undefined|\[object/);
    expect(report).toMatch(/development-set/i);
    expect(readFileSync(join(good, OUTPUT_FILES.modelCard), 'utf8')).toMatch(
      /No figure involves an LLM/,
    );
  });
});

describe('the validator catches faults', () => {
  const cases: [string, string, (t: string) => string, RegExp][] = [
    ['missing required file', OUTPUT_FILES.report, () => '', /required file evaluation_report\.md/],
    [
      'wrong column order in decisions',
      OUTPUT_FILES.decisions,
      (t) => t.replace('decision,reason_codes', 'reason_codes,decision'),
      /header and column order/,
    ],
    [
      'an extra column in decisions',
      OUTPUT_FILES.decisions,
      (t) =>
        t
          .split('\n')
          .map((l, i) => (l ? `${l},${i === 0 ? 'extra' : 'x'}` : l))
          .join('\n'),
      /header and column order|no extra columns/,
    ],
    [
      'a missing application row',
      OUTPUT_FILES.decisions,
      (t) =>
        lines(t)
          .filter((_l, i) => i !== 5)
          .join('\n'),
      /one row per evaluation application/,
    ],
    [
      'a score with three decimals',
      OUTPUT_FILES.decisions,
      (t) => t.replace(/,1\.0000,/, ',1.000,'),
      /values, dates/,
    ],
    [
      'an impossible re-KYC date',
      OUTPUT_FILES.decisions,
      (t) => t.replace(/2034-03-05/, '2034-02-30'),
      /values, dates/,
    ],
    [
      'an unknown reason code',
      OUTPUT_FILES.decisions,
      (t) => t.replace('LOW_EXTRACTION_CONFIDENCE', 'LOW_CONFIDENCE'),
      /values, dates/,
    ],
    [
      'an APPROVE with a reason code',
      OUTPUT_FILES.decisions,
      (t) => editRow(t, 3, (c) => [c[0] as string, 'APPROVE', 'PEP_MATCH', ...c.slice(3)]),
      /values, dates/,
    ],
    [
      'a REJECT with risk and re-KYC filled in',
      OUTPUT_FILES.decisions,
      (t) => {
        const l = lines(t);
        const i = l.findIndex((x) => x.includes(',REJECT,'));
        return editRow(t, i, (c) => [...c.slice(0, 4), 'LOW', '2036-03-05']);
      },
      /values, dates/,
    ],
    [
      'reason codes out of rule order',
      OUTPUT_FILES.decisions,
      (t) =>
        t.replace(
          /DOCUMENT_MISSING\|DOCUMENT_TYPE_MISMATCH/,
          'DOCUMENT_TYPE_MISMATCH|DOCUMENT_MISSING',
        ),
      /values, dates/,
    ],
    [
      'a re-KYC date that does not match the risk period',
      OUTPUT_FILES.decisions,
      (t) => t.replace('MEDIUM,2034-03-05', 'MEDIUM,2036-03-05'),
      /values, dates/,
    ],
    [
      'a confidence with one decimal in extraction',
      OUTPUT_FILES.extraction,
      (t) => t.replace(/,0\.97\n/, ',0.9\n'),
      /every value is valid/,
    ],
    [
      'a document without its doc_type row',
      OUTPUT_FILES.extraction,
      (t) =>
        lines(t)
          .filter((l) => !l.startsWith('D3000200,doc_type,'))
          .join('\n'),
      /exactly one doc_type row/,
    ],
    [
      'a date not in YYYY-MM-DD in extraction',
      OUTPUT_FILES.extraction,
      (t) => t.replace(/,dob,(\d{4})-(\d{2})-(\d{2}),/, ',dob,$3/$2/$1,'),
      /every value is valid/,
    ],
    [
      'an invalid PAN in extraction',
      OUTPUT_FILES.extraction,
      (t) => t.replace(/,pan_number,ZZ/, ',pan_number,zz'),
      /every value is valid/,
    ],
    [
      'a sample row that no longer matches the expected columns',
      SAMPLE_FILES.decisions,
      (t) => t.replace('A2000004,REVIEW,NAME_MISMATCH_MINOR', 'A2000004,APPROVE,'),
      /sample mock output/,
    ],
  ];
  it.each(cases)('%s', (_name, file, change, expected) => {
    const dir = damaged(file, change);
    try {
      const problems = failing(dir);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.map((p) => p.name).join('\n')).toMatch(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('repeatable and safe', () => {
  it('two independent runs produce byte-identical files', async () => {
    const [a, b] = [tmp('onboardiq-r1-'), tmp('onboardiq-r2-')];
    await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: a });
    await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: b });
    for (const f of [...Object.values(OUTPUT_FILES), SAMPLE_FILES.decisions])
      expect(sha(join(a, f))).toBe(sha(join(b, f)));
  }, 60_000);

  it('never writes into, or changes, the supplied input files', async () => {
    const snapshot = () =>
      readdirSync(REAL_DATA_DIR)
        .sort()
        .map((f) => `${f}:${sha(join(REAL_DATA_DIR, f))}`);
    const before = snapshot();
    await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: tmp('onboardiq-safe-') });
    expect(snapshot()).toEqual(before);
    await expect(
      generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: REAL_DATA_DIR }),
    ).rejects.toThrow(/refusing to write outputs into the input folder/);
    await expect(
      generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: join(REAL_DATA_DIR, 'out') }),
    ).rejects.toThrow(/refusing/);
    expect(snapshot()).toEqual(before);
  }, 60_000);

  const dbUrl = process.env.TEST_DATABASE_URL;
  (dbUrl ? it : it.skip)(
    'from two brand-new empty databases the files are identical, and equal to the files-only path',
    async () => {
      const [a, b, f] = [tmp('onboardiq-db1-'), tmp('onboardiq-db2-'), tmp('onboardiq-fl-')];
      for (const out of [a, b])
        await withFreshDatabase(dbUrl as string, REAL_DATA_DIR, (prisma) =>
          generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: out, prisma }),
        );
      await generateOutputs({ dataDir: REAL_DATA_DIR, outputDir: f });
      for (const file of [...Object.values(OUTPUT_FILES), SAMPLE_FILES.decisions])
        expect(sha(join(a, file))).toBe(sha(join(b, file)));
      // the three CSV deliverables do not depend on whether the data came from the database or from the files
      for (const file of [
        OUTPUT_FILES.decisions,
        OUTPUT_FILES.extraction,
        OUTPUT_FILES.aiDecisions,
        SAMPLE_FILES.decisions,
      ])
        expect(sha(join(a, file))).toBe(sha(join(f, file)));
      expect(validateOutputs(a, REAL_DATA_DIR).filter((c) => !c.ok)).toEqual([]);
    },
    180_000,
  );
});
