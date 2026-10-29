import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { callerOf } from '../../http/auth-context.js';
import { parse } from '../../http/validate.js';
import { requireRole } from '../auth/guards.js';
import { correctionsBody } from './application.schemas.js';
import type { CorrectionsService } from './corrections.service.js';
import type { ProcessingService } from './processing.service.js';

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  processing: ProcessingService;
  corrections: CorrectionsService;
}

/** Case lifecycle routes, mounted at /api/v1/applications. */
export function caseRouter({ prisma, authenticate, processing, corrections }: Deps): Router {
  const router = Router();
  const applicant = [authenticate, requireRole(prisma, 'APPLICANT')];

  // Application form (FR-2). Documents are uploaded next, then the case is submitted.
  router.post('/', ...applicant, async (req, res) => {
    res.status(201).json(await processing.createApplication(callerOf(req), req.body));
  });

  // Submission: extraction, rules, routing. The applicant only learns the resulting status.
  router.post('/:applicationId/submit', ...applicant, async (req, res) => {
    const app = await processing.submit(callerOf(req), String(req.params.applicationId));
    res.json({ application_id: app.application_id, status: app.status });
  });

  router.post('/:applicationId/resubmit', ...applicant, async (req, res) => {
    const app = await processing.resubmit(callerOf(req), String(req.params.applicationId));
    res.json({ application_id: app.application_id, status: app.status });
  });

  // KYC Officer: correct extracted fields (each with a reason); the rules re-run and the case goes to the checker.
  router.post(
    '/:applicationId/corrections',
    authenticate,
    requireRole(prisma, 'KYC_OFFICER'),
    async (req, res) => {
      const body = parse(correctionsBody, req.body);
      res.json(await corrections.correct(callerOf(req), String(req.params.applicationId), body));
    },
  );

  return router;
}
