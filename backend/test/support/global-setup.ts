// Creates and migrates a dedicated "<db>_test" database so integration tests never touch real data.
// If PostgreSQL is not reachable the DB tests are skipped (and say so), the other tests still run.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

function testUrl(): string | null {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL && existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const base = process.env.DATABASE_URL;
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export default async function setup(): Promise<void> {
  const url = testUrl();
  if (!url) {
    console.warn('[test] No DATABASE_URL/TEST_DATABASE_URL: database tests will be SKIPPED.');
    return;
  }
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!dbName.endsWith('_test'))
    throw new Error(`Refusing to run tests on database "${dbName}": name must end with _test`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const prisma = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const found = await prisma.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (found.length === 0) await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    console.warn(
      `[test] PostgreSQL not reachable (${(err as Error).message.split('\n').pop()}): database tests will be SKIPPED.`,
    );
    return;
  } finally {
    await prisma.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  process.env.TEST_DATABASE_URL = url;
}
