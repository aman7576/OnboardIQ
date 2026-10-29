import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { callerOf } from '../../http/auth-context.js';
import { conflict, HttpError } from '../../http/errors.js';
import type { ApplicationsService } from '../applications/applications.service.js';
import { requireRole } from '../auth/guards.js';
import type { LlmClient } from '../extraction/ai/llm.js';
import { SummaryWithheld, writeSummary, type CaseForSummary } from './summary.js';

const REVIEW_STATUSES = new Set(['IN_REVIEW', 'PENDING_CHECKER']);

/** GET /api/v1/applications/:id/ai-summary. Officers only; applicants never see AI output about their case. */
export function summaryRouter(deps: {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  applications: ApplicationsService;
  llm: LlmClient | undefined;
  now: () => Date;
}): Router {
  const router = Router();
  router.get(
    '/:applicationId/ai-summary',
    deps.authenticate,
    requireRole(deps.prisma, 'KYC_OFFICER', 'COMPLIANCE_OFFICER'),
    async (req, res) => {
      // Scope check first (404 for cases the officer may not see), whether or not an LLM is configured.
      const view = (await deps.applications.detail(
        callerOf(req),
        String(req.params.applicationId),
      )) as unknown as CaseForSummary & { status: string };
      if (!deps.llm)
        throw new HttpError(
          503,
          'AI_SUMMARY_DISABLED',
          'No LLM is configured for reviewer summaries (REVIEW_SUMMARY_LLM=none)',
        );
      if (!REVIEW_STATUSES.has(view.status) || view.evaluation?.decision !== 'REVIEW')
        throw conflict(
          'NOT_A_REVIEW_CASE',
          'Summaries are written only for cases whose rules decision is REVIEW',
        );
      try {
        res.json(await writeSummary(deps.llm, view, deps.now()));
      } catch (err) {
        if (err instanceof SummaryWithheld)
          throw new HttpError(
            502,
            'AI_SUMMARY_WITHHELD',
            `The AI summary was withheld: ${err.message}`,
          );
        throw new HttpError(503, 'AI_SUMMARY_UNAVAILABLE', 'The LLM did not answer'); // never echo the prompt or key
      }
    },
  );
  return router;
}
