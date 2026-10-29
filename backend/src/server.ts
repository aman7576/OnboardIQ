import { createApp } from './app.js';
import { ConfigError } from './config/env.js';
import { loadConfig } from './config/load.js';
import { dataDir, outputDir, storageDir } from './config/paths.js';
import { createPrisma } from './db/prisma.js';
import { createGroqChatClient } from './modules/chat/chat.client.js';
import { createLlmClient } from './modules/extraction/ai/llm-clients.js';

function start(): void {
  let env;
  try {
    env = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const prisma = createPrisma(env.DATABASE_URL);
  const extractionLlm = createLlmClient(env.EXTRACTION_LLM, env);
  const summaryLlm = createLlmClient(env.REVIEW_SUMMARY_LLM, env);
  const chat = env.GROQ_API_KEY
    ? createGroqChatClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_CHAT_MODEL })
    : undefined;
  const app = createApp({
    prisma,
    config: {
      environment: env.NODE_ENV,
      sessionSecret: env.SESSION_SECRET,
      sessionTtlMinutes: env.SESSION_TTL_MINUTES,
      coreBankingServiceKey: env.CORE_BANKING_SERVICE_KEY,
      storageDir: storageDir(env),
      dataDir: dataDir(env),
      outputDir: outputDir(env),
      extractionProvider: env.EXTRACTION_PROVIDER,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      ...(env.STAFF_ENROLLMENT_CODE ? { staffEnrollmentCode: env.STAFF_ENROLLMENT_CODE } : {}),
    },
    ...(extractionLlm ? { llm: extractionLlm } : {}),
    ...(summaryLlm ? { summaryLlm } : {}),
    ...(chat ? { chat } : {}),
    log: (line) => console.log(line),
  });

  const server = app.listen(env.PORT, () => {
    console.log(
      `[api] ${env.NODE_ENV} listening on http://localhost:${env.PORT} (extraction: ${env.EXTRACTION_PROVIDER}, extraction LLM: ${extractionLlm ? `${extractionLlm.name}/${extractionLlm.model}` : 'none'}, summary LLM: ${summaryLlm ? `${summaryLlm.name}/${summaryLlm.model}` : 'none'}, chatbot: ${chat ? chat.model : 'off'})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
