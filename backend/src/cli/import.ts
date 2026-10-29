// npm run import -- [reference] [sample] [eval] [--all]
// Safe to run repeatedly: unchanged rows are skipped, conflicting rows are rejected, and a
// target with any rejected row writes nothing. Input files are only ever read.
import { dataDir } from '../config/paths.js';
import { formatResult, runImport, type ImportTarget } from '../import/run.js';
import { cliContext } from './context.js';

const ORDER: ImportTarget[] = ['REFERENCE', 'SAMPLE', 'EVAL'];

function targetsFromArgs(args: string[]): ImportTarget[] | string {
  if (args.length === 0 || args.includes('--all')) return ORDER;
  const picked = new Set<ImportTarget>();
  for (const a of args) {
    const t = a.toUpperCase();
    if (t !== 'REFERENCE' && t !== 'SAMPLE' && t !== 'EVAL')
      return `Unknown target "${a}". Use: reference, sample, eval or --all.`;
    picked.add(t);
  }
  return ORDER.filter((t) => picked.has(t)); // always dependency order
}

async function main(): Promise<number> {
  const ctx = cliContext();
  if (!ctx) return 1;
  const targets = targetsFromArgs(process.argv.slice(2));
  if (typeof targets === 'string') {
    console.error(targets);
    return 1;
  }
  let code = 0;
  try {
    for (const target of targets) {
      const result = await runImport(ctx.prisma, target, { dataDir: dataDir(ctx.env) });
      console.log(formatResult(result));
      if (!result.committed) {
        code = 1;
        break; // later targets depend on this one
      }
    }
  } finally {
    await ctx.prisma.$disconnect();
  }
  return code;
}

process.exitCode = await main();
