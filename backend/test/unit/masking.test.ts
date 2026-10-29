import { describe, expect, it } from 'vitest';
import { maskAadhaar, maskPan } from '../../src/modules/applications/masking.js';

describe('masking', () => {
  it('masks PAN as in the spec (ZZKXXXXX4Q)', () => {
    expect(maskPan('ZZKPS1234Q')).toBe('ZZKXXXXX4Q');
    expect(maskPan('ZZKPS1234Q')).toHaveLength(10);
  });

  it('never reveals a short or odd value', () => {
    expect(maskPan('ABC')).toBe('XXX');
    expect(maskPan('')).toBe('');
  });

  it('shows only the last four Aadhaar digits', () => {
    expect(maskAadhaar('4821')).toBe('XXXXXXXX4821');
  });
});
