// npm run perf: measures the non-functional targets of the spec and writes output/performance_report.md.
//   - one application evaluated through the API (submit: mock extraction + rules + persistence) <= 2 s
//   - AI extraction per document <= 1 s without an LLM (<= 10 s with one; no LLM is configured here)
//   - the 100-application batch with the mock extraction <= 60 s (the real command, process start included)
//   - concurrency: of N simultaneous actions on one case exactly one succeeds, the rest get 409
// Runs against a throw-away database (<db>_perf, dropped at the end). A target is reported as met only when the
// measured MAXIMUM is within it.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { cpus, tmpdir, totalmem, type, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { loadConfig } from '../config/load.js';
import { dataDir, outputDir } from '../config/paths.js';
import { createAiProvider } from '../modules/extraction/ai/ai-provider.js';
import { createScratchDatabase } from './scratch-db.js';
import { seedDemoUsers } from './seed-users.js';

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
  return {
    n: s.length,
    min: s[0] ?? 0,
    p50: at(50),
    p95: at(95),
    max: s.at(-1) ?? 0,
    mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
  };
}
const f = (n: number) => n.toFixed(1);
const row = (label: string, st: ReturnType<typeof stats>, limitMs: number) =>
  `| ${label} | ${st.n} | ${f(st.p50)} | ${f(st.p95)} | ${f(st.max)} | ${limitMs.toLocaleString('en-IN')} ms | ${st.max <= limitMs ? 'met (max within target)' : '**NOT met**'} |`;

async function main() {
  const env = loadConfig();
  const db = await createScratchDatabase(env, 'perf');
  const storage = mkdtempSync(join(tmpdir(), 'onboardiq-perf-'));
  const password = randomBytes(18).toString('base64url'); // throw-away, never printed
  try {
    const { prisma } = db;
    await seedDemoUsers(prisma, { NODE_ENV: 'test', SEED_DEMO_PASSWORD: password });
    const applicant = await prisma.user.findUniqueOrThrow({
      where: { email: 'applicant1@onboardiq.test' },
    });
    await prisma.application.updateMany({
      where: { applicant_user_id: null },
      data: { applicant_user_id: applicant.id },
    });
    const app = createApp({
      prisma,
      config: {
        environment: 'test',
        sessionSecret: env.SESSION_SECRET,
        sessionTtlMinutes: 60,
        coreBankingServiceKey: env.CORE_BANKING_SERVICE_KEY,
        storageDir: storage,
        dataDir: dataDir(env),
        outputDir: outputDir(env),
        extractionProvider: 'mock',
      },
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const login = async (email: string) =>
      (
        (await (
          await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
        ).json()) as { token: string }
      ).token;
    const token = await login('applicant1@onboardiq.test');
    const auth = { authorization: `Bearer ${token}` };

    // Only the applicant's own cases (the seed gives one sample case to the second demo applicant).
    const ids = (
      await prisma.application.findMany({
        where: { status: 'SUBMITTED', applicant_user_id: applicant.id },
        orderBy: { application_id: 'asc' },
        select: { application_id: true },
      })
    ).map((a) => a.application_id);
    // 1. Concurrency first, on one untouched case: 10 simultaneous submissions.
    const raceId = ids.shift() ?? '';
    const race = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${base}/applications/${raceId}/submit`, { method: 'POST', headers: auth }).then(
          (r) => r.status,
        ),
      ),
    );

    // 2. API evaluation latency: submit every remaining application, one at a time.
    const submitMs: number[] = [];
    const outcomes: Record<string, number> = {};
    for (const id of ids) {
      const t0 = performance.now();
      const res = await fetch(`${base}/applications/${id}/submit`, {
        method: 'POST',
        headers: auth,
      });
      submitMs.push(performance.now() - t0);
      const body = (await res.json()) as { status?: string };
      outcomes[body.status ?? `HTTP ${res.status}`] =
        (outcomes[body.status ?? `HTTP ${res.status}`] ?? 0) + 1;
    }
    server.close();

    // 3. AI extraction per document (no LLM), over every supplied document text.
    const ai = createAiProvider();
    const texts = [
      'case_02_document_text_sample_V1.0.jsonl',
      'case_02_document_text_eval_V1.0.jsonl',
    ].flatMap((file) =>
      readFileSync(join(dataDir(env), file), 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { doc_id: string; text: string }),
    );
    const aiMs: number[] = [];
    for (const d of texts) {
      const t0 = performance.now();
      await ai.extract({ docId: d.doc_id, text: d.text });
      aiMs.push(performance.now() - t0);
    }

    // 4. The real batch command for the 100 evaluation applications, process start included (3 runs).
    const batchOut = join(storage, 'decisions_perf.csv');
    const batchMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      execFileSync(
        join(BACKEND, 'node_modules', '.bin', 'tsx'),
        ['src/cli/batch.ts', '--output', batchOut],
        { cwd: BACKEND, stdio: 'pipe' },
      );
      batchMs.push(performance.now() - t0);
    }
    const batchRows = readFileSync(batchOut, 'utf8').trim().split('\n').length - 1;
    const pg = ((await prisma.$queryRaw<{ v: string }[]>`SELECT version() AS v`)[0]?.v ?? '').split(
      ',',
    )[0];

    const sSubmit = stats(submitMs);
    const sAi = stats(aiMs);
    const sBatch = stats(batchMs);
    const won = race.filter((s) => s === 200).length;
    const lost = race.filter((s) => s === 409).length;
    const report = [
      '# Performance and concurrency report',
      '',
      `Measured ${new Date().toISOString().slice(0, 10)} with \`npm run perf\` (backend/src/cli/perf.ts). Numbers are wall-clock`,
      'milliseconds on the machine below; a target is marked met only when the **maximum** is within it.',
      '',
      '## Environment',
      '',
      `- ${type()} ${release()}, ${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} cores), ${Math.round(totalmem() / 1024 ** 3)} GB RAM`,
      `- Node ${process.version}; ${pg}; API and database on the same machine (Docker), HTTP over localhost`,
      '- Throw-away database loaded with the supplied files; mock extraction for the API run; no LLM configured',
      '',
      '## Latency',
      '',
      '| Measurement | n | p50 | p95 | max | Target | Result |',
      '| --- | ---: | ---: | ---: | ---: | --- | --- |',
      row(
        'One application through the API (`POST /submit`: extraction + rules R1-R17 + routing + audit, mock provider)',
        sSubmit,
        2000,
      ),
      row('AI extraction per document, no LLM (all 474 supplied texts)', sAi, 1000),
      row(
        'Batch: 100 evaluation applications, real command incl. process start (3 runs)',
        sBatch,
        60000,
      ),
      '',
      `API run outcomes over ${ids.length} applications: ${Object.entries(outcomes)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}. Batch wrote ${batchRows} rows.`,
      '',
      'The 10-second limit with an LLM is enforced by a timeout (tested with a provider that hangs); it is not measured',
      'here because no LLM is configured.',
      '',
      '## Concurrency',
      '',
      `10 simultaneous \`POST /applications/${raceId}/submit\` requests: **${won}** succeeded (200), **${lost}** got 409, ${race.length - won - lost} other.`,
      `Result: ${won === 1 && lost === race.length - 1 ? 'only one succeeds; the others receive HTTP 409 (target met)' : '**target NOT met**'}.`,
      '',
    ].join('\n');
    writeFileSync(join(outputDir(env), 'performance_report.md'), report);
    console.log(report);
  } finally {
    await db.drop();
    rmSync(storage, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
