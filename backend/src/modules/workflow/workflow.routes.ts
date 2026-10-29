import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { callerOf } from '../../http/auth-context.js';
import { parse } from '../../http/validate.js';
import type { ApplicationsService } from '../applications/applications.service.js';
import { requireRole } from '../auth/guards.js';
import { checkerBody, recommendationBody } from './workflow.schemas.js';
import type { WorkflowService } from './workflow.service.js';

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  applications: ApplicationsService;
  workflow: WorkflowService;
}

/** Officer-only routes. Mounted at /api/v1. */
export function workflowRouter({ prisma, authenticate, applications, workflow }: Deps): Router {
  const router = Router();
  // KYC Officer: cases to review. Compliance Officer: cases waiting for a checker.
  router.get(
    '/review/queue',
    authenticate,
    requireRole(prisma, 'KYC_OFFICER', 'COMPLIANCE_OFFICER'),
    async (req, res) => {
      const status = callerOf(req).role === 'KYC_OFFICER' ? 'IN_REVIEW' : 'PENDING_CHECKER';
      res.json({ queue: status, applications: await applications.queue(status) });
    },
  );

  router.post(
    '/applications/:applicationId/recommendation',
    authenticate,
    requireRole(prisma, 'KYC_OFFICER'),
    async (req, res) => {
      const body = parse(recommendationBody, req.body);
      res
        .status(201)
        .json(await workflow.recommend(callerOf(req), String(req.params.applicationId), body));
    },
  );

  router.post(
    '/applications/:applicationId/checker-decision',
    authenticate,
    requireRole(prisma, 'COMPLIANCE_OFFICER'),
    async (req, res) => {
      const body = parse(checkerBody, req.body);
      res.json(await workflow.decide(callerOf(req), String(req.params.applicationId), body));
    },
  );

  return router;
}
