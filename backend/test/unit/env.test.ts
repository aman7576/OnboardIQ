import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://onboardiq:pw@localhost:5432/onboardiq',
  SESSION_SECRET: 'a'.repeat(32),
  CORE_BANKING_SERVICE_KEY: 'b'.repeat(16),
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error('expected ConfigError');
}

describe('parseEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.EXTRACTION_PROVIDER).toBe('mock');
    expect(env.SESSION_TTL_MINUTES).toBe(60);
    expect(env.SEED_DEMO_PASSWORD).toBeUndefined();
  });

  it('coerces PORT and accepts EXTRACTION_PROVIDER=ai', () => {
    const env = parseEnv({ ...valid, PORT: '8080', EXTRACTION_PROVIDER: 'ai' });
    expect(env.PORT).toBe(8080);
    expect(env.EXTRACTION_PROVIDER).toBe('ai');
  });

  it('names every missing required variable in one error', () => {
    const problems = problemsOf({ NODE_ENV: 'development' });
    expect(problems.join('\n')).toMatch(/DATABASE_URL: is required but not set/);
    expect(problems.join('\n')).toMatch(/SESSION_SECRET: is required but not set/);
    expect(problems.join('\n')).toMatch(/CORE_BANKING_SERVICE_KEY: is required but not set/);
  });

  it('treats empty strings as not set', () => {
    expect(problemsOf({ ...valid, DATABASE_URL: '  ' })).toEqual([
      expect.stringMatching(/^DATABASE_URL: is required but not set/),
    ]);
  });

  it('error message tells the user how to fix it', () => {
    expect(() => parseEnv({})).toThrow(/Copy \.env\.example to \.env/);
  });

  it.each([
    ['DATABASE_URL', 'mysql://x@y/z', /postgresql:\/\/ connection URL/],
    ['SESSION_SECRET', 'short', /at least 32 characters/],
    ['SEED_DEMO_PASSWORD', 'short', /at least 12 characters/],
    ['SESSION_TTL_MINUTES', '0', /SESSION_TTL_MINUTES/],
    ['EXTRACTION_PROVIDER', 'llm', /"mock" or "ai"/],
    ['NODE_ENV', 'staging', /one of development, test, production/],
    ['PORT', '70000', /PORT/],
  ])('rejects invalid %s', (key, value, pattern) => {
    expect(problemsOf({ ...valid, [key]: value }).join('\n')).toMatch(pattern);
  });

  it('rejects .env.example placeholders in production only', () => {
    const withPlaceholder = { ...valid, SESSION_SECRET: 'change-me-change-me-change-me-change-me' };
    expect(() => parseEnv(withPlaceholder)).not.toThrow();
    expect(problemsOf({ ...withPlaceholder, NODE_ENV: 'production' }).join('\n')).toMatch(
      /SESSION_SECRET: still contains the "change-me" placeholder/,
    );
  });
});
