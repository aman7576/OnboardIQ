import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { callerOf } from '../../http/auth-context.js';
import { chain } from '../../http/chain.js';
import { notFound, unauthorized } from '../../http/errors.js';
import { authorizeApplication } from '../applications/applications.service.js';
import { requireRole } from '../auth/guards.js';
import { serviceKeyMatches } from '../internal/service-key.js';
import type { ExtractionService } from './extraction.service.js';

const DOC_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * POST /api/v1/documents/:docId/extract (spec FR-3). The caller is either the backend itself
 * (x-service-key, spec section 3) or a KYC / Compliance Officer re-running extraction.
 * Applicants never get confidence data, so they cannot call it.
 */
export function extractionRouter(
  prisma: PrismaClient,
  authenticate: RequestHandler,
  extraction: ExtractionService,
  serviceKey: string,
): Router {
  const router = Router();
  const officers = chain(authenticate, requireRole(prisma, 'KYC_OFFICER', 'COMPLIANCE_OFFICER'));

  const serviceOrOfficer: RequestHandler = (req, res, next) => {
    const supplied = req.get('x-service-key');
    if (supplied === undefined) return officers(req, res, next);
    if (!serviceKeyMatches(serviceKey, supplied)) return next(unauthorized('Service key required'));
    res.locals.viaServiceKey = true;
    next();
  };

  router.post('/:docId/extract', serviceOrOfficer, async (req, res) => {
    const docId = String(req.params.docId);
    const viaService = res.locals.viaServiceKey === true;
    const doc = DOC_ID.test(docId)
      ? await prisma.document.findUnique({ where: { doc_id: docId } })
      : null;

    if (!doc) {
      if (viaService) return void res.json(extraction.unknown(docId)); // spec: unknown document -> OTHER, 0.00
      throw notFound('Document not found');
    }
    if (!viaService) await authorizeApplication(prisma, callerOf(req), doc.application_id);
    res.json(await extraction.extractDocument(doc, viaService ? null : callerOf(req)));
  });

  return router;
}
