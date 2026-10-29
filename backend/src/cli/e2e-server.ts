// npm run e2e:server: a throw-away API for the browser (Playwright) tests. It creates its own database
// "<name>_e2e", migrates it, imports the supplied data, seeds the demo accounts with a fixed TEST password and
// serves the real application on E2E_API_PORT (default 3101). The database is dropped when the process stops.
// Never touches the development database and refuses to run in production.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../config/load.js';
import { dataDir, outputDir } from '../config/paths.js';
import { createScratchDatabase } from './scratch-db.js';
import { seedDemoUsers } from './seed-users.js';

/** Test-only value, also used by the Playwright tests. It protects nothing: the database exists only during the run. */
export const E2E_PASSWORD = 'E2e-Test-Passw0rd!';
const PORT = Number(process.env.E2E_API_PORT ?? 3101);

async function main(): Promise<void> {
  const env = loadConfig();
  const db = await createScratchDatabase(env, 'e2e');
  const { prisma } = db;
  await seedDemoUsers(prisma, { NODE_ENV: 'test', SEED_DEMO_PASSWORD: E2E_PASSWORD });
  // One more sample case for the applicant used by the browser tests (example 9: unreadable PAN on the scan).
  const applicant = await prisma.user.findUniqueOrThrow({
    where: { email: 'applicant1@onboardiq.test' },
  });
  await prisma.application.updateMany({
    where: { application_id: 'A2000009', applicant_user_id: null },
    data: { applicant_user_id: applicant.id },
  });

  const storageDir = mkdtempSync(join(tmpdir(), 'onboardiq-e2e-'));
  const app = createApp({
    prisma,
    config: {
      environment: 'test',
      sessionSecret: env.SESSION_SECRET,
      sessionTtlMinutes: 60,
      coreBankingServiceKey: env.CORE_BANKING_SERVICE_KEY,
      storageDir,
      dataDir: dataDir(env),
      outputDir: outputDir(env),
      extractionProvider: 'mock', // deterministic: the supplied extraction_mock files
    },
    log: () => undefined,
  });
  const server = app.listen(PORT, () =>
    console.log(`[e2e-api] ready on http://localhost:${PORT} (${db.name})`),
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await db.drop();
    rmSync(storageDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
