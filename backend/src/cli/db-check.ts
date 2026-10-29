// npm run db:check — verifies config and that PostgreSQL answers, with an actionable message.
import { ConfigError } from '../config/env.js';
import { loadConfig } from '../config/load.js';
import { createPrisma, pingDatabase, redactUrl } from '../db/prisma.js';

async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  const prisma = createPrisma(config.DATABASE_URL);
  try {
    await pingDatabase(prisma);
    console.log(`Database OK: ${redactUrl(config.DATABASE_URL)}`);
    return 0;
  } catch (err) {
    console.error(`Cannot reach PostgreSQL at ${redactUrl(config.DATABASE_URL)}`);
    console.error(
      `Reason: ${err instanceof Error ? err.message.split('\n').filter(Boolean).pop() : String(err)}`,
    );
    console.error('Start the database with: npm run db:up   (needs Docker Desktop running)');
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
