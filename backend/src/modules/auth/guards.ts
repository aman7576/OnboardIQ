import type { PrismaClient, Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../../http/errors.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import type { AuthService } from './auth.service.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/** Requires a valid bearer token and attaches the caller as req.auth. */
export function authenticate(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw unauthorized();
    req.auth = await auth.authenticate(token);
    next();
  };
}

/** Role gate (403). Must run after authenticate. Every denial is audited. */
export function requireRole(prisma: PrismaClient, ...allowed: Role[]): RequestHandler {
  return async (req, _res, next) => {
    const caller = req.auth;
    if (!caller) throw unauthorized();
    if (!allowed.includes(caller.role)) {
      await recordAudit(prisma, {
        type: 'ACCESS_DENIED',
        actor: actorOf(caller),
        details: { reason: 'ROLE', method: req.method, path: req.path, required: allowed },
      });
      throw forbidden('FORBIDDEN_ROLE', 'Your role is not permitted to perform this action');
    }
    next();
  };
}
