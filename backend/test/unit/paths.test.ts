import { describe, expect, it } from 'vitest';
import { storageDir } from '../../src/config/paths.js';
import type { Env } from '../../src/config/env.js';

describe('document storage location', () => {
  it('defaults to <repo>/storage, outside frontend/ (the only folder that is ever served)', () => {
    const dir = storageDir({} as Env);
    expect(dir).toMatch(/\/storage$/);
    expect(dir).not.toContain('/frontend');
    expect(dir).not.toContain('/dist');
  });

  it('can be moved with STORAGE_DIR', () => {
    expect(storageDir({ STORAGE_DIR: '/srv/docs' } as Env)).toBe('/srv/docs');
  });
});
