import { PrismaClient } from '@prisma/client';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

/** Throws if PostgreSQL cannot answer a trivial query. */
export async function pingDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** Hides the password so a connection URL can be logged. */
export function redactUrl(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:****@');
}
