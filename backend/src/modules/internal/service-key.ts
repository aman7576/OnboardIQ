import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { unauthorized } from '../../http/errors.js';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Guards the simulated-service endpoints. They accept only the service key from the environment
 * (header x-service-key); a user's bearer token is not enough and is not looked at.
 * Both sides are hashed so the comparison is constant-time and length-independent.
 */
export const serviceKeyMatches = (expected: string, supplied: string): boolean =>
  timingSafeEqual(digest(supplied), digest(expected));

export function requireServiceKey(expectedKey: string): RequestHandler {
  const expected = digest(expectedKey);
  return (req, _res, next) => {
    const supplied = req.get('x-service-key');
    if (!supplied || !timingSafeEqual(digest(supplied), expected))
      throw unauthorized('Service key required');
    next();
  };
}
