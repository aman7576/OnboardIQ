import { createHmac, randomBytes } from 'node:crypto';

const PREFIX = 'oiq_'; // recognisable prefix so leaked tokens are easy to find and revoke

/** 256 random bits; the plain token is shown to the client once and never stored. */
export const newSessionToken = (): string => PREFIX + randomBytes(32).toString('base64url');

/** Keyed hash stored in sessions.token_hash (64 hex characters). */
export const hashSessionToken = (token: string, secret: string): string =>
  createHmac('sha256', secret).update(token).digest('hex');
