// npm run db:reset -- --confirm [--no-seed]
// Drops every table and re-applies the migrations, then re-imports the data pack.
// Refused unless --confirm is given and the database is local (or NODE_ENV=test).
import { spawnSync } from 'node:child_process';
import { dataDir } from '../config/paths.js';
import { redactUrl } from '../db/prisma.js';
import { formatResult, runImport, type ImportTarget } from '../import/run.js';
import { cliContext } from './context.js';
import { formatProcessed, processReceived } from './process.js';
import { formatSeedUsers, seedDemoUsers } from './seed-users.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);

export function resetRefusal(
  env: { NODE_ENV: string; DATABASE_URL: string },
  confirmed: boolean,
): string | null {
  if (env.NODE_ENV === 'production') return 'Refusing to reset: NODE_ENV=production.';
  const host = new URL(env.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) return `Refusing to reset: database host "${host}" is not local.`;
  if (!confirmed)
    return (
      'This DELETES ALL DATA in ' +
      redactUrl(env.DATABASE_URL) +
      '.\nRe-run with --confirm to proceed.'
    );
  return null;
}

async function main(): Promise<number> {
  const ctx = cliContext();
  if (!ctx) return 1;
  const args = process.argv.slice(2);
  const refusal = resetRefusal(ctx.env, args.includes('--confirm'));
  if (refusal) {
    console.error(refusal);
    await ctx.prisma.$disconnect();
    return 1;
  }

  console.log(`Resetting ${redactUrl(ctx.env.DATABASE_URL)} ...`);
  const reset = spawnSync('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: ctx.env.DATABASE_URL },
  });
  if (reset.status !== 0) return reset.status ?? 1;

  if (args.includes('--no-seed')) {
    await ctx.prisma.$disconnect();
    return 0;
  }
  try {
    for (const target of ['REFERENCE', 'SAMPLE', 'EVAL'] as ImportTarget[]) {
      const result = await runImport(ctx.prisma, target, { dataDir: dataDir(ctx.env) });
      console.log(formatResult(result));
      if (!result.committed) return 1;
    }
    console.log(formatSeedUsers(await seedDemoUsers(ctx.prisma, ctx.env)));
    // Imported applications arrive as SUBMITTED; run them through extraction + rules unless asked not to.
    if (!process.argv.includes('--no-process'))
      console.log(formatProcessed(await processReceived(ctx.prisma, ctx.env)));
    return 0;
  } finally {
    await ctx.prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('reset.ts')) process.exitCode = await main();
