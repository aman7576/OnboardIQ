import { describe, expect, it } from 'vitest';
import {
  burnPasswordCheck,
  hashPassword,
  verifyPassword,
} from '../../src/modules/auth/password.js';

const FAST = { N: 1024, r: 8, p: 1 };

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-9', FAST);
    expect(await verifyPassword('Correct-Horse-9', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-9', hash)).toBe(false);
  });

  it('never stores the password and salts every hash', async () => {
    const a = await hashPassword('Same-Password-1', FAST);
    const b = await hashPassword('Same-Password-1', FAST);
    expect(a).not.toContain('Same-Password-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
  });

  it('uses the OWASP-recommended cost by default', async () => {
    expect((await hashPassword('Default-Cost-Pass-1')).startsWith('scrypt$32768$8$3$')).toBe(true);
  });

  it('rejects malformed or tampered stored hashes instead of crashing', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1024$8$1$onlysalt')).toBe(false);
    // an absurd cost parameter would exhaust memory: refused, not executed
    expect(await verifyPassword('x', 'scrypt$1073741824$8$1$c2FsdA$a2V5')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1000$8$1$c2FsdA$a2V5')).toBe(false); // N not a power of two
  });

  it('burnPasswordCheck completes without throwing', async () => {
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined();
  });
});
