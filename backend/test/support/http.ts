import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { LlmClient } from '../../src/modules/extraction/ai/llm.js';
import type { ExtractionProvider } from '../../src/modules/extraction/provider.js';
import { REAL_DATA_DIR } from './data-dir.js';
import { createApp } from '../../src/app.js';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.js';
import { CHEAP_HASH, PASSWORD } from './world.js';

export const SERVICE_KEY = 'test-service-key-0123456789';
export const SESSION_SECRET = 's'.repeat(40);
export const SESSION_TTL_MINUTES = 60;

export interface BuildOptions {
  extraction?: ExtractionProvider;
  extractionKind?: 'mock' | 'ai';
  llm?: LlmClient;
  summaryLlm?: LlmClient;
  extractionTimeoutMs?: number;
  storageDir?: string;
  outputDir?: string;
}

export interface TestApp {
  storageDir: string;
  app: Express;
  clock: { now: Date };
  logs: string[];
  /** Signs in and returns the bearer token. */
  login: (email: string, password?: string) => Promise<string>;
}

/** The real app wired to the test database, with a movable clock and a captured request log. */
export function buildApp(prisma: PrismaClient, options: BuildOptions = {}): TestApp {
  const storageDir = options.storageDir ?? mkdtempSync(join(tmpdir(), 'onboardiq-storage-'));
  const clock = { now: new Date() };
  const logs: string[] = [];
  const now = () => clock.now;
  const app = createApp({
    prisma,
    config: {
      environment: 'test',
      sessionSecret: SESSION_SECRET,
      sessionTtlMinutes: SESSION_TTL_MINUTES,
      coreBankingServiceKey: SERVICE_KEY,
      storageDir,
      dataDir: REAL_DATA_DIR,
      outputDir: options.outputDir ?? mkdtempSync(join(tmpdir(), 'onboardiq-output-')),
      extractionProvider: options.extractionKind ?? 'mock',
    },
    log: (line) => logs.push(line),
    now,
    hashParams: CHEAP_HASH,
    ...(options.extraction ? { extraction: options.extraction } : {}),
    ...(options.llm ? { llm: options.llm } : {}),
    ...(options.summaryLlm ? { summaryLlm: options.summaryLlm } : {}),
    ...(options.extractionTimeoutMs ? { extractionTimeoutMs: options.extractionTimeoutMs } : {}),
    throttle: new LoginThrottle(5, 15 * 60_000, () => clock.now.getTime()),
  });
  const login = async (email: string, password = PASSWORD): Promise<string> => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200)
      throw new Error(`login for ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return (res.body as { token: string }).token;
  };
  return { app, clock, logs, login, storageDir };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
