// npm run db:process: runs extraction + rules + routing for the received (SUBMITTED) applications of the data pack,
// with the provider chosen by EXTRACTION_PROVIDER. Without it every imported case stays SUBMITTED until someone
// submits it, and the dashboard and queues are empty. Non-destructive and repeatable.
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import { dataDir } from '../config/paths.js';
import { createLlmClient } from '../modules/extraction/ai/llm-clients.js';
import { createExtractionService } from '../modules/extraction/extraction.service.js';
import {
  createProvider,
  EXTRACTION_TIMEOUT_MS,
  withFallback,
} from '../modules/extraction/providers.js';
import { createProcessingService } from '../modules/workflow/processing.service.js';
import { cliContext } from './context.js';

export async function processReceived(prisma: PrismaClient, env: Env) {
  const llm = env.EXTRACTION_LLM === 'none' ? undefined : createLlmClient(env.EXTRACTION_LLM, env);
  const provider = withFallback(
    createProvider(env.EXTRACTION_PROVIDER, dataDir(env), llm),
    EXTRACTION_TIMEOUT_MS,
  );
  const processing = createProcessingService({
    prisma,
    extraction: createExtractionService(prisma, provider),
    provider: env.EXTRACTION_PROVIDER === 'ai' ? 'AI' : 'MOCK',
    now: () => new Date(),
  });
  return processing.processReceived(null);
}

export const formatProcessed = (r: Awaited<ReturnType<typeof processReceived>>): string =>
  `PROCESSED ${r.processed} received application(s): ${
    Object.entries(r.by_status)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none waiting'
  }${r.skipped.length ? `; skipped ${r.skipped.join(', ')}` : ''}`;

async function main(): Promise<number> {
  const ctx = cliContext();
  if (!ctx) return 1;
  try {
    console.log(formatProcessed(await processReceived(ctx.prisma, ctx.env)));
    return 0;
  } finally {
    await ctx.prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('process.ts')) process.exitCode = await main();
