// Password hashing with scrypt (Node built-in, no native add-on). The cost parameters are stored in
// each hash, so they can be raised later without invalidating existing passwords.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// OWASP password-storage cheat sheet: scrypt N=2^15, r=8, p=3.
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const KEY_BYTES = 32;
const MAX = { N: 2 ** 20, r: 16, p: 16 }; // a tampered stored hash must not be able to exhaust memory

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: 256 * 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  const { N, r, p } = params;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

function parseStored(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const valid =
    Number.isInteger(Math.log2(params.N)) &&
    params.N >= 2 &&
    params.N <= MAX.N &&
    params.r >= 1 &&
    params.r <= MAX.r &&
    params.p >= 1 &&
    params.p <= MAX.p;
  if (!valid) return null;
  return { params, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.params);
  return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash so an unknown e-mail costs the same time as a wrong password
 * (no user enumeration through response time).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
}
