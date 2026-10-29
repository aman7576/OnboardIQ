import { describe, expect, it } from 'vitest';
import { hashSessionToken, newSessionToken } from '../../src/modules/auth/session-token.js';

describe('session tokens', () => {
  it('are long, prefixed and unique', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).toMatch(/^oiq_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('are stored as a keyed 64-hex hash, not as the token', () => {
    const token = newSessionToken();
    const hash = hashSessionToken(token, 'k'.repeat(32));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token, 'k'.repeat(32))).toBe(hash);
    expect(hashSessionToken(token, 'j'.repeat(32))).not.toBe(hash);
  });
});
