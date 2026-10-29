import type { PrismaClient } from '@prisma/client';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pingDatabase } from './db/prisma.js';
import { errorHandler, routeNotFound } from './http/error-handler.js';
import { requestLogger, type LogSink } from './http/request-log.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { createApplicationsService } from './modules/applications/applications.service.js';
import { applicationsRouter } from './modules/applications/applications.routes.js';
import { createDocumentsService } from './modules/applications/documents.service.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { authenticate } from './modules/auth/guards.js';
import { LoginThrottle } from './modules/auth/login-throttle.js';
import type { ScryptParams } from './modules/auth/password.js';
import { healthRouter } from './modules/health/health.routes.js';
import { internalRouter } from './modules/internal/internal.routes.js';
import { createDiskStore, type FileStore } from './modules/documents/storage.js';
import { createUploadService } from './modules/documents/upload.service.js';
import { uploadRouter } from './modules/documents/upload.routes.js';
import type { LlmClient } from './modules/extraction/ai/llm.js';
import { createExtractionService } from './modules/extraction/extraction.service.js';
import { extractionRouter } from './modules/extraction/extraction.routes.js';
import type { ExtractionProvider } from './modules/extraction/provider.js';
import {
  createProvider,
  EXTRACTION_TIMEOUT_MS,
  withFallback,
} from './modules/extraction/providers.js';
import { caseRouter } from './modules/workflow/case.routes.js';
import { createCorrectionsService } from './modules/workflow/corrections.service.js';
import { createMaintenanceService } from './modules/workflow/maintenance.service.js';
import { openApiDocument, SWAGGER_CSP, SWAGGER_HTML, SWAGGER_INIT } from './docs/openapi.js';
import { summaryRouter } from './modules/ai-summary/summary.routes.js';
import { createProcessingService } from './modules/workflow/processing.service.js';
import { createDashboardService } from './modules/admin/dashboard.service.js';
import { referenceRouter } from './modules/reference/reference.routes.js';
import { createWorkflowService } from './modules/workflow/workflow.service.js';
import { chatRouter } from './modules/chat/chat.routes.js';
import type { ChatClient } from './modules/chat/chat.client.js';
import { workflowRouter } from './modules/workflow/workflow.routes.js';

export interface AppConfig {
  environment: string;
  sessionSecret: string;
  sessionTtlMinutes: number;
  coreBankingServiceKey: string;
  storageDir: string;
  dataDir: string;
  outputDir: string;
  extractionProvider: 'mock' | 'ai';
  /** Enrollment code for new bank officers (STAFF_ENROLLMENT_CODE); unset = officer registration off. */
  staffEnrollmentCode?: string;
  /** Reverse proxies in front of the API (TRUST_PROXY_HOPS); 0 = none, req.ip is the socket address. */
  trustProxyHops?: number;
}

export interface AppDeps {
  prisma: PrismaClient;
  config: AppConfig;
  /** Request log sink; omit to log nothing (tests). */
  log?: LogSink;
  /** Injectable for tests (session expiry, throttle window). */
  now?: () => Date;
  hashParams?: ScryptParams;
  throttle?: LoginThrottle;
  /** Test overrides: a provider, its timeout, and where uploaded files go. */
  extraction?: ExtractionProvider;
  /** Optional LLM for the "ai" provider (built from configuration by the server). */
  llm?: LlmClient;
  /** Optional LLM for AI-5 reviewer summaries (REVIEW_SUMMARY_LLM); without it the endpoint answers 503. */
  summaryLlm?: LlmClient;
  /** Optional applicant chatbot (Groq); without it POST /chat answers 503. */
  chat?: ChatClient;
  extractionTimeoutMs?: number;
  store?: FileStore;
}

/** Builds the whole Express app from injected dependencies, so tests run against a test database. */
export function createApp(deps: AppDeps): Express {
  const { prisma, config } = deps;
  const now = deps.now ?? (() => new Date());

  const auth = createAuthService({
    prisma,
    sessionSecret: config.sessionSecret,
    sessionTtlMinutes: config.sessionTtlMinutes,
    throttle: deps.throttle ?? new LoginThrottle(5, 15 * 60_000, () => now().getTime()),
    now,
    ...(config.staffEnrollmentCode ? { staffEnrollmentCode: config.staffEnrollmentCode } : {}),
    ...(deps.hashParams ? { hashParams: deps.hashParams } : {}),
  });
  const authn = authenticate(auth);
  const applications = createApplicationsService(prisma);
  const documents = createDocumentsService(prisma);
  const workflow = createWorkflowService(prisma, now);
  const uploads = createUploadService(
    prisma,
    deps.store ?? createDiskStore(config.storageDir),
    now,
  );
  const provider = withFallback(
    deps.extraction ?? createProvider(config.extractionProvider, config.dataDir, deps.llm),
    deps.extractionTimeoutMs ?? EXTRACTION_TIMEOUT_MS,
    (message) =>
      deps.log?.(JSON.stringify({ at: new Date().toISOString(), level: 'warn', message })),
  );
  const extraction = createExtractionService(prisma, provider);
  const providerKind = config.extractionProvider === 'ai' ? 'AI' : 'MOCK';
  const processing = createProcessingService({ prisma, extraction, provider: providerKind, now });
  const corrections = createCorrectionsService(prisma, providerKind);
  const maintenance = createMaintenanceService(prisma, providerKind, now);
  const dashboard = createDashboardService(prisma, now);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  if (deps.log) app.use(requestLogger(deps.log));

  app.use(
    '/api/v1/health',
    healthRouter({ environment: config.environment, pingDb: () => pingDatabase(prisma) }),
  );

  // API documentation (OpenAPI 3.1 + Swagger UI). Contains no personal data.
  app.get('/api/v1/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });
  app.get('/api/docs', (_req, res) => {
    res.set('Content-Security-Policy', SWAGGER_CSP).type('html').send(SWAGGER_HTML);
  });
  app.get('/api/docs/init.js', (_req, res) => {
    res.type('application/javascript').send(SWAGGER_INIT);
  });

  const api = Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store'); // responses carry personal data and tokens
    next();
  });
  api.use('/auth', authRouter(auth, authn));
  api.use('/chat', chatRouter({ prisma, authenticate: authn, chat: deps.chat, now }));
  api.use('/reference', referenceRouter(prisma, authn));
  api.use('/applications', uploadRouter(prisma, authn, uploads));
  api.use('/applications', caseRouter({ prisma, authenticate: authn, processing, corrections }));
  api.use('/documents', extractionRouter(prisma, authn, extraction, config.coreBankingServiceKey));
  api.use(
    '/applications',
    applicationsRouter({ prisma, authenticate: authn, applications, documents }),
  );
  api.use(
    '/applications',
    summaryRouter({ prisma, authenticate: authn, applications, llm: deps.summaryLlm, now }),
  );
  api.use('/', workflowRouter({ prisma, authenticate: authn, applications, workflow }));
  api.use(
    '/admin',
    adminRouter(prisma, authn, { maintenance, processing, dashboard, outputDir: config.outputDir }),
  );
  app.use('/api/v1', api);

  app.use('/internal', internalRouter(prisma, config.coreBankingServiceKey));

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}
