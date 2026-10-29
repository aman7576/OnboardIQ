import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../http/validate.js';
import { SYSTEM } from '../audit/audit.js';
import { openAccount } from './core-banking.js';
import { requireServiceKey } from './service-key.js';

const accountBody = z.strictObject({ application_id: z.string().min(1).max(40) });

/**
 * Simulated back-end services. Mounted at /internal (not under /api), so the web server's /api
 * proxy never forwards to it, and every call needs the service key.
 */
export function internalRouter(prisma: PrismaClient, serviceKey: string): Router {
  const router = Router();
  router.use(requireServiceKey(serviceKey));

  router.post('/core-banking/accounts', async (req, res) => {
    const { application_id } = parse(accountBody, req.body);
    const { account, created } = await openAccount(prisma, application_id, SYSTEM);
    res.status(created ? 201 : 200).json(account);
  });

  return router;
}
