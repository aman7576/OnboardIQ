// Regression tests for the official worked examples (spec 6.4). Expected values are copied from the
// specification text, not from the CSV; the inputs are the supplied applications A2000001-A2000010.
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/rules/evaluate.js';
import { loadCases, loadReference } from '../../src/rules/file-data.js';
import { toDecisionResponse } from '../../src/rules/response.js';
import { routeStatus } from '../../src/rules/routing.js';
import type { ClassifiedDocument } from '../../src/rules/types.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';

const reference = loadReference(REAL_DATA_DIR);
const cases = new Map(
  loadCases(REAL_DATA_DIR, 'SAMPLE').map((c) => [c.application.applicationId, c]),
);

function decide(id: string, tweak?: (docs: ClassifiedDocument[]) => ClassifiedDocument[]) {
  const c = cases.get(id);
  if (!c) throw new Error(`missing ${id}`);
  const docs = tweak ? tweak(c.documents) : c.documents;
  const evaluation = evaluate(
    c.application,
    docs,
    reference.config,
    reference.watchlists,
    reference.existingCustomers,
  );
  return {
    evaluation,
    response: toDecisionResponse(id, evaluation, docs),
    application: c.application,
  };
}

describe('worked examples 1-10 (A2000001-A2000010)', () => {
  it('example 1: clean application is APPROVED, score 1.0000, LOW, 2036-03-04, AUTO_APPROVED', () => {
    const { response } = decide('A2000001');
    expect(response).toMatchObject({
      decision: 'APPROVE',
      reason_codes: [],
      name_match_score: 1,
      risk_category: 'LOW',
      rekyc_due_date: '2036-03-04',
      status: 'AUTO_APPROVED',
    });
  });

  it('example 2: age 17 is REJECTED with AGE_BELOW_18; score 1.0000; risk and re-KYC empty; AUTO_REJECTED', () => {
    const { response, application } = decide('A2000002');
    expect(application.dob).toBe('2008-09-10');
    expect(response).toMatchObject({
      decision: 'REJECT',
      reason_codes: ['AGE_BELOW_18'],
      name_match_score: 1,
      risk_category: null,
      rekyc_due_date: null,
      status: 'AUTO_REJECTED',
    });
  });

  it('example 3: PAN card ZZMPN3465S vs declared ZZMPN3456S is REJECTED with PAN_MISMATCH', () => {
    const { response, evaluation } = decide('A2000003');
    expect(response).toMatchObject({
      decision: 'REJECT',
      reason_codes: ['PAN_MISMATCH'],
      status: 'AUTO_REJECTED',
    });
    expect(evaluation.trace.find((t) => t.rule === 'R6')?.compared).toEqual({
      declared: 'ZZMPN3456S',
      onCard: 'ZZMPN3465S',
    });
  });

  it('example 4: "Ravi K Sharma" on the PAN card is REVIEW / NAME_MISMATCH_MINOR with score 0.7647, LOW, 2036-03-04, IN_REVIEW', () => {
    const { response } = decide('A2000004');
    expect(response).toMatchObject({
      decision: 'REVIEW',
      reason_codes: ['NAME_MISMATCH_MINOR'],
      name_match_score: 0.7647,
      risk_category: 'LOW',
      rekyc_due_date: '2036-03-04',
      status: 'IN_REVIEW',
    });
  });

  it('example 5: a bill dated 2025-11-04 (120 days old) is REVIEW / ADDRESS_PROOF_STALE, score 1.0000, LOW', () => {
    const { response } = decide('A2000005');
    expect(response).toMatchObject({
      decision: 'REVIEW',
      reason_codes: ['ADDRESS_PROOF_STALE'],
      name_match_score: 1,
      risk_category: 'LOW',
      status: 'IN_REVIEW',
    });
  });

  it('example 6: Valko Quillon (dob 1986-02-23) equals sanctions entry SAN0002: REJECT / SANCTIONS_MATCH', () => {
    const { response, evaluation } = decide('A2000006');
    expect(response).toMatchObject({
      decision: 'REJECT',
      reason_codes: ['SANCTIONS_MATCH'],
      status: 'AUTO_REJECTED',
    });
    expect(evaluation.screening.sanctions.hits.map((h) => h.entryId)).toContain('SAN0002');
    expect(evaluation.screening.sanctions.hits.find((h) => h.entryId === 'SAN0002')).toMatchObject({
      result: 'MATCH',
      dobEqual: true,
      similarity: 1,
    });
  });

  it('example 7: Zoya Menon (dob 1982-10-15) equals PEP0001: REVIEW / PEP_MATCH, risk HIGH, re-KYC 2028-03-04', () => {
    const { response, evaluation } = decide('A2000007');
    expect(response).toMatchObject({
      decision: 'REVIEW',
      reason_codes: ['PEP_MATCH'],
      risk_category: 'HIGH',
      rekyc_due_date: '2028-03-04',
      status: 'IN_REVIEW',
    });
    expect(evaluation.screening.pep.hits.map((h) => h.entryId)).toContain('PEP0001');
  });

  it('example 8: no Aadhaar uploaded (the file declared as Aadhaar is a bank statement): DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH, score 1.0000 (PAN only), LOW', () => {
    const { response, evaluation } = decide('A2000008');
    expect(response).toMatchObject({
      decision: 'REVIEW',
      reason_codes: ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH'],
      name_match_score: 1,
      risk_category: 'LOW',
    });
    expect(evaluation.trace.find((t) => t.rule === 'R1')?.compared).toEqual({
      missing: ['AADHAAR_CARD'],
    });
  });

  it('example 9: poor PAN scan (pan_number ZZTP59O12Y at 0.62) is REVIEW / LOW_EXTRACTION_CONFIDENCE and PAN_MISMATCH is NOT evaluated', () => {
    const { response, evaluation } = decide('A2000009');
    expect(response).toMatchObject({
      decision: 'REVIEW',
      reason_codes: ['LOW_EXTRACTION_CONFIDENCE'],
    });
    expect(evaluation.trace.find((t) => t.rule === 'R6')).toMatchObject({ status: 'SKIPPED' });
  });

  it('example 9 (AI side): the same case with the PAN read correctly at confidence >= 0.80 gives APPROVE', () => {
    const { response } = decide('A2000009', (docs) =>
      docs.map((d) =>
        d.docType === 'PAN_CARD'
          ? {
              ...d,
              fields: d.fields.map((f) =>
                f.name === 'pan_number' ? { ...f, value: 'ZZTPS9012Y', confidence: 0.93 } : f,
              ),
            }
          : d,
      ),
    );
    expect(response).toMatchObject({ decision: 'APPROVE', reason_codes: [] });
  });

  it('example 10: JEWELLER_BULLION_DEALER with a driving licence is APPROVE, HIGH, re-KYC 2028-03-04, and waits in PENDING_CHECKER', () => {
    const { response } = decide('A2000010');
    expect(response).toMatchObject({
      decision: 'APPROVE',
      reason_codes: [],
      risk_category: 'HIGH',
      rekyc_due_date: '2028-03-04',
      status: 'PENDING_CHECKER',
    });
    expect(response.documents.map((d) => d.doc_type)).toContain('DRIVING_LICENCE');
  });
});

describe('example 12 (engine part): the officer corrects the PAN of example 9', () => {
  it('re-running the rules with pan_number ZZTPS9012Y at confidence 1.00 (source OFFICER) gives APPROVE, no reason codes', () => {
    const { response } = decide('A2000009', (docs) =>
      docs.map((d) =>
        d.docType === 'PAN_CARD'
          ? {
              ...d,
              fields: d.fields.map((f) =>
                f.name === 'pan_number' ? { ...f, value: 'ZZTPS9012Y', confidence: 1 } : f,
              ),
            }
          : d,
      ),
    );
    expect(response).toMatchObject({ decision: 'APPROVE', reason_codes: [] });
    // The case still goes to the checker; that is workflow, decided by the status machine (see workflow tests).
  });
});

describe('decision is separate from workflow status', () => {
  it('routes exactly as spec 6.1.2', () => {
    expect(routeStatus('APPROVE', 'LOW')).toBe('AUTO_APPROVED');
    expect(routeStatus('APPROVE', 'MEDIUM')).toBe('AUTO_APPROVED');
    expect(routeStatus('APPROVE', 'HIGH')).toBe('PENDING_CHECKER');
    expect(routeStatus('REVIEW', 'LOW')).toBe('IN_REVIEW');
    expect(routeStatus('REVIEW', 'HIGH')).toBe('IN_REVIEW');
    expect(routeStatus('REJECT', null)).toBe('AUTO_REJECTED');
  });

  it('the engine result has no status field; the API response adds it from routing', () => {
    const { evaluation, response } = decide('A2000001');
    expect(Object.keys(evaluation).sort()).toEqual([
      'decision',
      'nameMatchScore',
      'reasonCodes',
      'rekycDueDate',
      'riskCategory',
      'screening',
      'trace',
    ]);
    expect(response.status).toBe('AUTO_APPROVED');
  });

  it('the decision response has the structure of spec section 6.3', () => {
    const { response } = decide('A2000004');
    expect(Object.keys(response).sort()).toEqual([
      'application_id',
      'decision',
      'documents',
      'name_match_score',
      'reason_codes',
      'rekyc_due_date',
      'risk_category',
      'status',
    ]);
    expect(response.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          doc_id: expect.any(String),
          doc_type: 'PAN_CARD',
          confidence: expect.any(Number),
        }),
      ]),
    );
    expect(Array.isArray(response.reason_codes)).toBe(true);
  });
});

describe('decision response status', () => {
  it('uses the real case status when given: a corrected case is APPROVE by the rules but PENDING_CHECKER in the workflow', () => {
    const c = cases.get('A2000009');
    if (!c) throw new Error('missing');
    const e = evaluate(
      c.application,
      c.documents,
      reference.config,
      reference.watchlists,
      reference.existingCustomers,
    );
    expect(toDecisionResponse('A2000009', e, c.documents).status).toBe('IN_REVIEW'); // routing of a new REVIEW case
    expect(toDecisionResponse('A2000009', e, c.documents, 'PENDING_CHECKER').status).toBe(
      'PENDING_CHECKER',
    );
  });
});

describe('the engine is deterministic and pure', () => {
  it('gives the same answer twice and does not modify its inputs', () => {
    const c = cases.get('A2000004');
    if (!c) throw new Error('missing');
    const before = JSON.stringify([c.application, c.documents, reference.config]);
    const a = evaluate(
      c.application,
      c.documents,
      reference.config,
      reference.watchlists,
      reference.existingCustomers,
    );
    const b = evaluate(
      c.application,
      c.documents,
      reference.config,
      reference.watchlists,
      reference.existingCustomers,
    );
    expect(a).toEqual(b);
    expect(JSON.stringify([c.application, c.documents, reference.config])).toBe(before);
  });

  it('evaluates one application well inside the 2 second limit, and the 100 evaluation applications inside 60 seconds', () => {
    const started = performance.now();
    for (const c of loadCases(REAL_DATA_DIR, 'EVAL'))
      evaluate(
        c.application,
        c.documents,
        reference.config,
        reference.watchlists,
        reference.existingCustomers,
      );
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
