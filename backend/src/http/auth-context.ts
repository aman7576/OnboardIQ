import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { unauthorized } from './errors.js';

/** The authenticated caller, attached to the request by the authenticate middleware. */
export interface AuthContext {
  userId: string;
  role: Role;
  email: string;
  displayName: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** The caller of an authenticated route. Throws 401 if the authenticate middleware was not applied. */
export function callerOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
