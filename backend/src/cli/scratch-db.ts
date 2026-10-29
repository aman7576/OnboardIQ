// A throw-away PostgreSQL database "<db>_<suffix>" for the e2e server and the performance run: created, migrated
// and loaded with the supplied data; drop() removes it. The development database is never touched.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import { dataDir } from '../config/paths.js';
import { createPrisma } from '../db/prisma.js';
import { runImport } from '../import/run.js';

const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function createScratchDatabase(env: Env, suffix: 'e2e' | 'perf') {
  if (env.NODE_ENV === 'production')
    throw new Error('Scratch databases are never created in production');
  const name = `${new URL(env.DATABASE_URL).pathname.slice(1)}_${suffix}`;
  const url = withDatabase(env.DATABASE_URL, name);
  const admin = new PrismaClient({
    datasources: { db: { url: withDatabase(env.DATABASE_URL, 'postgres') } },
  });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = createPrisma(url);
  for (const target of ['REFERENCE', 'SAMPLE', 'EVAL'] as const) {
    const result = await runImport(prisma, target, { dataDir: dataDir(env) });
    if (!result.committed) throw new Error(`import ${target} failed`);
  }
  return {
    name,
    prisma,
    async drop() {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
