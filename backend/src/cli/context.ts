import type { PrismaClient } from '@prisma/client';
import { ConfigError, type Env } from '../config/env.js';
import { loadConfig } from '../config/load.js';
import { createPrisma } from '../db/prisma.js';

/** Loads config and a Prisma client for a CLI; prints config problems instead of a stack trace. */
export function cliContext(): { env: Env; prisma: PrismaClient } | null {
  try {
    const env = loadConfig();
    return { env, prisma: createPrisma(env.DATABASE_URL) };
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return null;
    }
    throw err;
  }
}
