import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';

/** Reference data the forms need (not personal data): any signed-in user may read it. */
export function referenceRouter(prisma: PrismaClient, authenticate: RequestHandler): Router {
  const router = Router();

  router.get('/occupations', authenticate, async (_req, res) => {
    const rows = await prisma.occupation.findMany({ orderBy: { description: 'asc' } });
    res.json({
      occupations: rows.map((o) => ({ code: o.occupation_code, description: o.description })),
    });
  });

  return router;
}
