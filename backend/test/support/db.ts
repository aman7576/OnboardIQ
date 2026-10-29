import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';
import { createPrisma } from '../../src/db/prisma.js';

/** URL of the throw-away test database (created by global-setup), or undefined if PostgreSQL is down. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** describe() that is skipped, with a warning from global-setup, when no test database exists. */
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

export const testPrisma = (): PrismaClient => createPrisma(TEST_DATABASE_URL as string);

/** Empties every table. Only ever runs on a database whose name ends with _test. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = rows[0]?.db;
  if (!db?.endsWith('_test')) throw new Error(`truncateAll refused on database "${db}"`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
