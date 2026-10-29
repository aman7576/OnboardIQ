import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.js';

describe('LoginThrottle', () => {
  it('blocks after the limit and releases when the window ends', () => {
    let t = 0;
    const throttle = new LoginThrottle(3, 60_000, () => t);
    for (let i = 0; i < 2; i++) throttle.recordFailure('k');
    expect(throttle.retryAfterSeconds('k')).toBe(0);
    throttle.recordFailure('k');
    expect(throttle.retryAfterSeconds('k')).toBe(60);
    t = 30_000;
    expect(throttle.retryAfterSeconds('k')).toBe(30);
    t = 60_000;
    expect(throttle.retryAfterSeconds('k')).toBe(0);
  });

  it('counts each key separately and clears on success', () => {
    const throttle = new LoginThrottle(1, 60_000, () => 0);
    throttle.recordFailure('a');
    expect(throttle.retryAfterSeconds('a')).toBeGreaterThan(0);
    expect(throttle.retryAfterSeconds('b')).toBe(0);
    throttle.clear('a');
    expect(throttle.retryAfterSeconds('a')).toBe(0);
  });
});
