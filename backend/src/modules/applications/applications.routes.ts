import { Router, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { callerOf } from '../../http/auth-context.js';
import { requireRole } from '../auth/guards.js';
import type { ApplicationsService } from './applications.service.js';
import type { DocumentsService } from './documents.service.js';

interface Deps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  applications: ApplicationsService;
  documents: DocumentsService;
}

export function applicationsRouter({
  prisma,
  authenticate,
  applications,
  documents,
}: Deps): Router {
  const router = Router();
  // Applicant: only their own applications.
  router.get('/mine', authenticate, requireRole(prisma, 'APPLICANT'), async (req, res) => {
    res.json({ applications: await applications.listMine(callerOf(req)) });
  });

  // Every :applicationId route below is object-level checked inside the service.
  router.get('/:applicationId', authenticate, async (req, res) => {
    res.json(await applications.detail(callerOf(req), String(req.params.applicationId)));
  });

  router.get('/:applicationId/documents', authenticate, async (req, res) => {
    res.json({ documents: await documents.list(callerOf(req), String(req.params.applicationId)) });
  });

  router.get('/:applicationId/documents/:docId', authenticate, async (req, res) => {
    res.json(
      await documents.view(
        callerOf(req),
        String(req.params.applicationId),
        String(req.params.docId),
      ),
    );
  });

  return router;
}
