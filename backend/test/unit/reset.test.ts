import { describe, expect, it } from 'vitest';
import { resetRefusal } from '../../src/cli/reset.js';
import { stableUuid } from '../../src/import/validate.js';

const local = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:pw@localhost:5432/onboardiq',
};

describe('db:reset safety', () => {
  it('requires --confirm', () => {
    expect(resetRefusal(local, false)).toMatch(/--confirm/);
    expect(resetRefusal(local, true)).toBeNull();
  });

  it('never runs in production', () => {
    expect(resetRefusal({ ...local, NODE_ENV: 'production' }, true)).toMatch(/production/);
  });

  it('never runs against a remote database', () => {
    const remote = { ...local, DATABASE_URL: 'postgresql://u:pw@db.example.com:5432/onboardiq' };
    expect(resetRefusal(remote, true)).toMatch(/not local/);
  });

  it('does not print the password in its warning', () => {
    expect(resetRefusal(local, false)).not.toContain('pw@');
  });
});

describe('stableUuid', () => {
  it('is deterministic and looks like a UUID', () => {
    const a = stableUuid('D3000001', 'MOCK', 'v1');
    expect(a).toBe(stableUuid('D3000001', 'MOCK', 'v1'));
    expect(a).not.toBe(stableUuid('D3000002', 'MOCK', 'v1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
