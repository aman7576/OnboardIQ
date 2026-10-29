import { describe, expect, it } from 'vitest';
import {
  buildFacts,
  buildSummaryPrompt,
  checkSummary,
  MAX_WORDS,
  type CaseForSummary,
} from '../../src/modules/ai-summary/summary.js';

// Shape of the staff view of worked example 9 (poor PAN scan).
const CASE: CaseForSummary = {
  application_id: 'A2000009',
  thresholds: { min_field_confidence: 0.8 },
  documents: [
    {
      doc_id: 'D3000025',
      declared_doc_type: 'PAN_CARD',
      extracted_fields: [
        { field_name: 'pan_number', value: 'ZZTP59O12Y', confidence: 0.62, source: 'MOCK' },
        { field_name: 'name', value: 'Imran Shaikh', confidence: 0.88, source: 'MOCK' },
      ],
    },
  ],
  evaluation: {
    decision: 'REVIEW',
    name_match_score: 1,
    screening: [],
    trace: [
      {
        rule: 'R3',
        code: 'LOW_EXTRACTION_CONFIDENCE',
        status: 'TRIGGERED',
        compared: {
          minFieldConfidence: 0.8,
          unusableRequiredFields: [{ docId: 'D3000025', field: 'pan_number' }],
        },
      },
      {
        rule: 'R6',
        code: 'PAN_MISMATCH',
        status: 'SKIPPED',
        skippedBecause: 'pan_number on the PAN card is missing or not usable',
      },
      { rule: 'R5', code: 'PAN_INVALID', status: 'PASSED' },
    ],
  },
};
const facts = buildFacts(CASE);
const answer = (summary: string) => JSON.stringify({ summary });

describe('AI-5 reviewer summary: facts and prompt', () => {
  it('gives the model only rule results and extracted values: no decision, no outcomes, no document text', () => {
    expect(facts.triggered_rules).toEqual([
      {
        rule: 'R3',
        code: 'LOW_EXTRACTION_CONFIDENCE',
        compared: CASE.evaluation!.trace[0]!.compared,
      },
    ]);
    expect(facts.skipped_rules.map((r) => r.code)).toEqual(['PAN_MISMATCH']);
    expect(facts.low_confidence_fields).toEqual([
      { doc_id: 'D3000025', field: 'pan_number', value: 'ZZTP59O12Y', confidence: 0.62 },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/REVIEW"|"REJECT|APPROVE|decision/);
  });

  it('puts the facts between random delimiters, tells the model they are untrusted, and forbids recommendations', () => {
    const a = buildSummaryPrompt(facts);
    const b = buildSummaryPrompt(facts);
    expect(a.user).not.toBe(b.user); // random token per call
    expect(a.system).toMatch(/UNTRUSTED DATA/);
    expect(a.system).toMatch(/Never recommend/);
    expect(a.system).toContain(`at most ${MAX_WORDS} words`);
  });
});

describe('AI-5 reviewer summary: output guardrails', () => {
  const good =
    'R3 fired: the PAN number on D3000025 was read as ZZTP59O12Y with confidence 0.62, below the 0.80 minimum, so R6 PAN comparison was not evaluated. Name match score is 1.';

  it('accepts a factual summary whose values all come from the case', () => {
    expect(checkSummary(answer(good), facts)).toMatchObject({ ok: true });
  });

  it('withholds any decision or advice wording', () => {
    for (const s of [
      'The PAN looks fine, approve it.',
      'Recommend rejection.',
      'The officer should correct the PAN.',
      'This case can be accepted.',
    ])
      expect(checkSummary(answer(s), facts)).toMatchObject({ ok: false });
  });

  it('withholds values that are not in the case data (no invented numbers or ids)', () => {
    expect(checkSummary(answer('The PAN was read as ZZTPS9012Y.'), facts)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('ZZTPS9012Y'),
    });
    expect(checkSummary(answer('Confidence was 0.55.'), facts)).toMatchObject({ ok: false });
  });

  it(`withholds a summary longer than ${MAX_WORDS} words`, () => {
    expect(
      checkSummary(
        answer(
          Array(MAX_WORDS + 1)
            .fill('word')
            .join(' '),
        ),
        facts,
      ),
    ).toMatchObject({ ok: false });
  });

  it('withholds answers that are not the schema (extra keys such as a decision, or no JSON)', () => {
    expect(
      checkSummary(JSON.stringify({ summary: 'R3 fired.', decision: 'APPROVE' }), facts),
    ).toMatchObject({ ok: false });
    expect(checkSummary('just text', facts)).toMatchObject({ ok: false });
  });
});
