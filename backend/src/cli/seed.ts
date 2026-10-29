// npm run db:seed [-- --no-process]: imports the data pack (reference, sample, eval), creates the demo users, and
// processes the received applications (extraction + rules + routing) so queues and the dashboard have data.
// Non-destructive and repeatable.
import { dataDir } from '../config/paths.js';
import { formatResult, runImport, type ImportTarget } from '../import/run.js';
import { cliContext } from './context.js';
import { formatProcessed, processReceived } from './process.js';
import { formatSeedUsers, seedDemoUsers } from './seed-users.js';

async function main(): Promise<number> {
  const ctx = cliContext();
  if (!ctx) return 1;
  try {
    for (const target of ['REFERENCE', 'SAMPLE', 'EVAL'] as ImportTarget[]) {
      const result = await runImport(ctx.prisma, target, { dataDir: dataDir(ctx.env) });
      console.log(formatResult(result));
      if (!result.committed) return 1; // later targets depend on this one
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

process.exitCode = await main();
