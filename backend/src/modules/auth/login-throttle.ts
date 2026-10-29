// Brute-force protection: after `max` failed logins for one (client, e-mail) within `windowMs`,
// further attempts get 429 until the window ends. In memory: fine for a single instance.
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds the caller must wait, or 0 when an attempt is allowed. */
  retryAfterSeconds(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    const elapsed = this.now() - entry.since;
    if (elapsed >= this.windowMs) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count >= this.max ? Math.ceil((this.windowMs - elapsed) / 1000) : 0;
  }

  recordFailure(key: string): void {
    const entry = this.failures.get(key);
    if (!entry || this.now() - entry.since >= this.windowMs) {
      this.failures.set(key, { count: 1, since: this.now() });
    } else {
      entry.count++;
    }
    if (this.failures.size > 10_000) this.sweep();
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private sweep(): void {
    for (const [key, entry] of this.failures)
      if (this.now() - entry.since >= this.windowMs) this.failures.delete(key);
  }
}
