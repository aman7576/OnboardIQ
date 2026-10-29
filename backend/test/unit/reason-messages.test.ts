import { describe, expect, it } from 'vitest';
import { applicantMessage, applicantMessages } from '../../src/rules/messages.js';
import { REASON_CODES } from '../../src/rules/types.js';

const config = { address_proof_max_age_days: 90, min_age: 18 };

describe('applicant reason messages (FR-8)', () => {
  it('every reason code has a readable message', () => {
    for (const code of REASON_CODES) {
      const m = applicantMessage(code, config);
      expect(m.length).toBeGreaterThan(15);
      expect(m).not.toContain('_'); // never shows a raw code
    }
  });

  it('say nothing about watchlists, scores or confidence, and share one generic compliance message', () => {
    const all = REASON_CODES.map((c) => applicantMessage(c, config)).join(' ');
    expect(all).not.toMatch(/sanction|PEP|watchlist|confidence|score|similarity/i);
    expect(applicantMessage('PEP_MATCH', config)).toBe(
      applicantMessage('SANCTIONS_POSSIBLE_MATCH', config),
    );
    expect(applicantMessage('SANCTIONS_MATCH', config)).not.toMatch(/sanction/i);
  });

  it('take limits from the configuration, and do not repeat a message', () => {
    expect(
      applicantMessage('ADDRESS_PROOF_STALE', { ...config, address_proof_max_age_days: 45 }),
    ).toContain('45 days');
    expect(applicantMessage('AGE_BELOW_18', { ...config, min_age: 21 })).toContain('21');
    expect(applicantMessages(['PEP_MATCH', 'SANCTIONS_POSSIBLE_MATCH'], config)).toHaveLength(1);
  });
});
