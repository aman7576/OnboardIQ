// A brand-new, empty PostgreSQL database for one run: created, migrated, loaded with the supplied data, and
// dropped afterwards. Two runs therefore start from equivalent clean states.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { runImport, type ImportTarget } from '../import/run.js';
import { createPrisma } from '../db/prisma.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PREFIX = 'onboardiq_out_';

export async function withFreshDatabase<T>(
  baseUrl: string,
  dataDir: string,
  work: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const base = new URL(baseUrl);
  if (!LOCAL_HOSTS.has(base.hostname))
    throw new Error(`refusing to create a scratch database on non-local host "${base.hostname}"`);
  const name = `${PREFIX}${randomBytes(4).toString('hex')}`; // only databases we created are ever dropped
  const target = new URL(baseUrl);
  target.pathname = `/${name}`;
  const admin = new URL(baseUrl);
  admin.pathname = '/postgres';

  const adminDb = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  let prisma: PrismaClient | undefined;
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: target.toString() },
      stdio: 'pipe',
    });
    prisma = createPrisma(target.toString());
    for (const t of ['REFERENCE', 'SAMPLE', 'EVAL'] as ImportTarget[]) {
      const result = await runImport(prisma, t, { dataDir });
      if (!result.committed)
        throw new Error(`import of ${t} was rejected: ${JSON.stringify(result.rejections[0])}`);
    }
    return await work(prisma);
  } finally {
    await prisma?.$disconnect();
    if (name.startsWith(PREFIX))
      await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await adminDb.$disconnect();
  }
}
