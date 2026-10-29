import { describe, expect, it } from 'vitest';
import {
  aadhaar,
  baseApp,
  bill,
  cleanDocs,
  codes,
  licence,
  pan,
  reference,
  run,
  traceOf,
  withField,
  withoutField,
} from './fixtures.js';

describe('R1 DOCUMENT_MISSING (REVIEW)', () => {
  it.each([
    ['PAN card', [aadhaar(), bill()], 'PAN_CARD'],
    ['Aadhaar card', [pan(), bill()], 'AADHAAR_CARD'],
    ['address proof', [pan(), aadhaar()], 'ADDRESS_PROOF'],
  ])('fires when there is no %s', (_n, docs, missing) => {
    const e = run({ docs });
    expect(codes(e)).toContain('DOCUMENT_MISSING');
    expect(traceOf(e, 'R1')?.compared).toEqual({ missing: [missing] });
    expect(e.decision).toBe('REVIEW');
  });
  it('accepts a bank statement or a driving licence as address proof', () => {
    expect(codes(run({ docs: [pan(), aadhaar(), licence()] }))).toEqual([]);
    expect(
      codes(
        run({
          docs: [
            pan(),
            aadhaar(),
            bill({ docType: 'BANK_STATEMENT', declaredDocType: 'BANK_STATEMENT' }),
          ],
        }),
      ),
    ).toEqual([]);
  });
  it('does not fire for a present document with low classification confidence (R3 reports that)', () => {
    expect(codes(run({ docs: [pan({ docTypeConfidence: 0.5 }), aadhaar(), bill()] }))).toEqual([
      'LOW_EXTRACTION_CONFIDENCE',
    ]);
  });
  it('a document classified OTHER does not count as any required type', () => {
    expect(
      codes(run({ docs: [pan(), aadhaar(), bill({ docType: 'OTHER', docTypeConfidence: 0.9 })] })),
    ).toEqual(['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH']);
  });
});

describe('R2 DOCUMENT_TYPE_MISMATCH (REVIEW)', () => {
  it('fires when any classified type differs from the declared type', () => {
    const e = run({ docs: [pan(), aadhaar({ declaredDocType: 'BANK_STATEMENT' }), bill()] });
    expect(codes(e)).toEqual(['DOCUMENT_TYPE_MISMATCH']);
    expect(traceOf(e, 'R2')?.compared).toEqual({
      mismatches: [{ docId: 'D2', declared: 'BANK_STATEMENT', classified: 'AADHAAR_CARD' }],
    });
  });
  it('is quiet when every type agrees', () =>
    expect(codes(run()).includes('DOCUMENT_TYPE_MISMATCH')).toBe(false));
});

describe('R3 LOW_EXTRACTION_CONFIDENCE (REVIEW)', () => {
  it('fires when a document type confidence is below 0.80, even for a non-selected document', () => {
    const extra = bill({ docId: 'D9', docTypeConfidence: 0.79 });
    expect(codes(run({ docs: [...cleanDocs(), extra] }))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
  });
  it('fires when a required field of a selected document is below 0.80 or missing', () => {
    expect(
      codes(run({ docs: [withField(pan(), 'pan_number', 'ZZKPS1234Q', 0.79), aadhaar(), bill()] })),
    ).toContain('LOW_EXTRACTION_CONFIDENCE');
    expect(
      codes(run({ docs: [pan(), withoutField(aadhaar(), 'aadhaar_last4'), bill()] })),
    ).toContain('LOW_EXTRACTION_CONFIDENCE');
    expect(
      codes(run({ docs: [pan(), aadhaar(), withField(bill(), 'document_date', '', 0.95)] })),
    ).toContain('LOW_EXTRACTION_CONFIDENCE');
  });
  it('0.80 exactly is usable', () => {
    expect(
      codes(run({ docs: [withField(pan(), 'pan_number', 'ZZKPS1234Q', 0.8), aadhaar(), bill()] })),
    ).toEqual([]);
  });
  it('ignores fields that are not required for the type (gender, address)', () => {
    expect(codes(run({ docs: [pan(), withField(aadhaar(), 'gender', 'M', 0.3), bill()] }))).toEqual(
      [],
    );
  });
  it('uses the threshold from the configuration', () => {
    const docs = [withField(pan(), 'pan_number', 'ZZKPS1234Q', 0.85), aadhaar(), bill()];
    expect(codes(run({ docs }))).toEqual([]);
    expect(codes(run({ docs, config: { min_field_confidence: 0.9 } }))).toContain(
      'LOW_EXTRACTION_CONFIDENCE',
    );
  });
});

describe('R4 AGE_BELOW_18 (REJECT)', () => {
  it('rejects an applicant under the minimum age', () => {
    const e = run({ app: { dob: '2008-09-10' } });
    expect(codes(e)).toContain('AGE_BELOW_18');
    expect(e.decision).toBe('REJECT');
  });
  it('passes on the 18th birthday and fails the day before', () => {
    expect(codes(run({ app: { dob: '2008-03-04' } })).includes('AGE_BELOW_18')).toBe(false);
    expect(codes(run({ app: { dob: '2008-03-05' } }))).toContain('AGE_BELOW_18');
  });
  it('takes the minimum age from the configuration', () => {
    expect(codes(run({ app: { dob: '2005-01-01' }, config: { min_age: 25 } }))).toContain(
      'AGE_BELOW_18',
    );
  });
});

describe('R5 PAN_INVALID (REJECT)', () => {
  it.each(['ZZKPS1234', 'zzkps1234q', 'ZZKPS12345', 'ZZKCS1234Q', 'ZZKFS1234Q'])(
    'rejects declared PAN %s',
    (panNumber) => {
      const e = run({ app: { panNumber } });
      expect(codes(e)).toContain('PAN_INVALID');
      expect(e.decision).toBe('REJECT');
    },
  );
  it('accepts a valid individual PAN', () =>
    expect(codes(run()).includes('PAN_INVALID')).toBe(false));
});

describe('R6 PAN_MISMATCH (REJECT)', () => {
  it('rejects when the usable PAN on the card differs from the declared PAN', () => {
    const e = run({ docs: [withField(pan(), 'pan_number', 'ZZMPN3465S'), aadhaar(), bill()] });
    expect(codes(e)).toEqual(['PAN_MISMATCH']);
    expect(traceOf(e, 'R6')?.compared).toEqual({ declared: 'ZZKPS1234Q', onCard: 'ZZMPN3465S' });
  });
  it('is skipped, not evaluated, when the PAN field is below the confidence threshold (example 9)', () => {
    const e = run({
      docs: [withField(pan(), 'pan_number', 'ZZTP59O12Y', 0.62), aadhaar(), bill()],
    });
    expect(traceOf(e, 'R6')).toMatchObject({ status: 'SKIPPED' });
    expect(codes(e)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
  });
  it('is skipped when there is no PAN card', () =>
    expect(traceOf(run({ docs: [aadhaar(), bill()] }), 'R6')?.status).toBe('SKIPPED'));
});

describe('R7 DOB_MISMATCH (REJECT)', () => {
  it('rejects when the PAN card dob differs', () =>
    expect(
      codes(run({ docs: [withField(pan(), 'dob', '1990-05-16'), aadhaar(), bill()] })),
    ).toEqual(['DOB_MISMATCH']));
  it('rejects when the Aadhaar dob differs', () =>
    expect(
      codes(run({ docs: [pan(), withField(aadhaar(), 'dob', '1991-05-15'), bill()] })),
    ).toEqual(['DOB_MISMATCH']));
  it('uses the one usable dob when the other is unusable', () => {
    const e = run({
      docs: [
        withField(pan(), 'dob', '1990-05-99', 0.4),
        withField(aadhaar(), 'dob', '1991-05-15'),
        bill(),
      ],
    });
    expect(codes(e)).toContain('DOB_MISMATCH');
  });
  it('is skipped when no dob is usable', () => {
    const e = run({
      docs: [
        withField(pan(), 'dob', 'I990-05-15', 0.5),
        withField(aadhaar(), 'dob', '1990-0S-15', 0.5),
        bill(),
      ],
    });
    expect(traceOf(e, 'R7')?.status).toBe('SKIPPED');
  });
});

describe('R8 AADHAAR_MISMATCH (REJECT)', () => {
  it('rejects a usable last four that differs', () =>
    expect(
      codes(run({ docs: [pan(), withField(aadhaar(), 'aadhaar_last4', '4822'), bill()] })),
    ).toEqual(['AADHAAR_MISMATCH']));
  it('is skipped when the field is not usable', () => {
    expect(
      traceOf(
        run({ docs: [pan(), withField(aadhaar(), 'aadhaar_last4', '047B', 0.62), bill()] }),
        'R8',
      )?.status,
    ).toBe('SKIPPED');
  });
});

describe('R9 NAME_MISMATCH (REJECT) and name_match_score', () => {
  it('rejects a score below 0.75', () => {
    const e = run({ docs: [withField(pan(), 'name', 'Totally Different'), aadhaar(), bill()] });
    expect(codes(e)).toContain('NAME_MISMATCH');
    expect(e.decision).toBe('REJECT');
  });
  it('the score is the LOWEST of the PAN and Aadhaar similarities', () => {
    const e = run({
      docs: [
        withField(pan(), 'name', 'Ravi K Sharma'),
        withField(aadhaar(), 'name', 'Ravi Kumar Sharma'),
        bill(),
      ],
    });
    expect(e.nameMatchScore).toBeCloseTo(1 - 4 / 17, 12);
    const flipped = run({ docs: [pan(), withField(aadhaar(), 'name', 'Ravi K Sharma'), bill()] });
    expect(flipped.nameMatchScore).toBeCloseTo(1 - 4 / 17, 12);
  });
  it('uses only usable names; with none usable the score is empty and R9/R11 are skipped', () => {
    const e = run({
      docs: [
        withField(pan(), 'name', 'R4VI', 0.5),
        withField(aadhaar(), 'name', 'R4VI', 0.5),
        bill(),
      ],
    });
    expect(e.nameMatchScore).toBeNull();
    expect(traceOf(e, 'R9')?.status).toBe('SKIPPED');
    expect(traceOf(e, 'R11')?.status).toBe('SKIPPED');
  });
  it('example 8 style: with only the PAN card usable the score comes from the PAN alone', () => {
    expect(run({ docs: [pan(), bill()] }).nameMatchScore).toBe(1);
  });
});

describe('R11 NAME_MISMATCH_MINOR (REVIEW)', () => {
  const minor = (name: string, app = {}) =>
    run({ app, docs: [withField(pan(), 'name', name), aadhaar(), bill()] });
  it('fires from 0.75 up to (not including) 0.90', () => {
    expect(codes(minor('Ravi K Sharma'))).toEqual(['NAME_MISMATCH_MINOR']); // 0.7647
    expect(
      codes(
        run({
          app: { fullName: 'Abcd' },
          docs: [withField(pan(), 'name', 'Abce'), withField(aadhaar(), 'name', 'Abce'), bill()],
        }),
      ),
    ).toEqual(['NAME_MISMATCH_MINOR']); // exactly 0.75
  });
  it('passes at exactly 0.90 (one character in ten)', () => {
    const e = run({
      app: { fullName: 'Abcdefghij' },
      docs: [
        withField(pan(), 'name', 'Abcdefghik'),
        withField(aadhaar(), 'name', 'Abcdefghik'),
        bill(),
      ],
    });
    expect(e.nameMatchScore).toBeCloseTo(0.9, 12);
    expect(codes(e)).toEqual([]);
  });
  it('and a lower threshold in the configuration changes the decision without code changes (FR-4)', () => {
    const docs = [withField(pan(), 'name', 'Ravi Kumar Sharmaa'), aadhaar(), bill()]; // similarity 1 - 1/18? see below
    const base = run({ docs });
    const stricter = run({
      docs,
      config: { name_match_threshold: Math.min(1, (base.nameMatchScore ?? 0) + 0.01) },
    });
    const looser = run({
      docs,
      config: { name_match_threshold: (base.nameMatchScore ?? 1) - 0.01 },
    });
    expect(codes(stricter)).toEqual(['NAME_MISMATCH_MINOR']);
    expect(codes(looser)).toEqual([]);
  });
});

describe('R12 DOCUMENT_EXPIRED (REVIEW)', () => {
  it('fires when a driving licence expired before the application date', () => {
    expect(codes(run({ docs: [pan(), aadhaar(), licence('2026-03-03')] }))).toEqual([
      'DOCUMENT_EXPIRED',
    ]);
  });
  it('does not fire when valid_until is the application date or later', () => {
    expect(codes(run({ docs: [pan(), aadhaar(), licence('2026-03-04')] }))).toEqual([]);
  });
  it('is not applicable to bills and is skipped when valid_until is unusable', () => {
    expect(traceOf(run(), 'R12')?.status).toBe('SKIPPED');
    expect(
      traceOf(
        run({ docs: [pan(), aadhaar(), withField(licence(), 'valid_until', '2O25-07-2B', 0.7)] }),
        'R12',
      )?.status,
    ).toBe('SKIPPED');
  });
});

describe('R13 ADDRESS_PROOF_STALE (REVIEW)', () => {
  const dated = (d: string) =>
    run({ docs: [pan(), aadhaar(), withField(bill(), 'document_date', d)] });
  it('fires when the bill is more than 90 days old (example 5: 120 days)', () =>
    expect(codes(dated('2025-11-04'))).toEqual(['ADDRESS_PROOF_STALE']));
  it('90 days is fine, 91 is stale', () => {
    expect(codes(dated('2025-12-04'))).toEqual([]);
    expect(codes(dated('2025-12-03'))).toEqual(['ADDRESS_PROOF_STALE']);
  });
  it('fires when dated after the application', () =>
    expect(codes(dated('2026-03-05'))).toEqual(['ADDRESS_PROOF_STALE']));
  it('applies to bank statements too, not to driving licences', () => {
    const statement = withField(
      bill({ docType: 'BANK_STATEMENT', declaredDocType: 'BANK_STATEMENT' }),
      'document_date',
      '2025-01-01',
    );
    expect(codes(run({ docs: [pan(), aadhaar(), statement] }))).toEqual(['ADDRESS_PROOF_STALE']);
    expect(traceOf(run({ docs: [pan(), aadhaar(), licence()] }), 'R13')?.status).toBe('SKIPPED');
  });
  it('uses the maximum age from the configuration', () => {
    expect(
      codes(
        run({
          docs: [pan(), aadhaar(), withField(bill(), 'document_date', '2025-12-04')],
          config: { address_proof_max_age_days: 30 },
        }),
      ),
    ).toEqual(['ADDRESS_PROOF_STALE']);
  });
});

describe('R14 ADDRESS_MISMATCH (REVIEW)', () => {
  it('fires when the usable pincode on the address proof differs', () =>
    expect(
      codes(run({ docs: [pan(), aadhaar(), withField(bill(), 'pincode', '560001')] })),
    ).toEqual(['ADDRESS_MISMATCH']));
  it('is skipped when the pincode is not usable', () =>
    expect(
      traceOf(run({ docs: [pan(), aadhaar(), withField(bill(), 'pincode', '5600I3', 0.5)] }), 'R14')
        ?.status,
    ).toBe('SKIPPED'));
});

const at = <T>(items: T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
};

const lists = {
  sanctions: [
    { id: 'SAN1', name: 'Ravi Kumar Sharma', alias: null, dob: '1990-05-15' },
    { id: 'SAN2', name: 'Someone Else', alias: 'Sharma Ravi Kumar', dob: null },
    { id: 'SAN3', name: 'Ravi Kumar Sharma', alias: null, dob: '1970-01-01' },
    { id: 'SAN4', name: 'Ravi Kumar Sharmi', alias: null, dob: '1990-05-15' },
    { id: 'SAN5', name: 'Rahul Verma', alias: null, dob: null },
  ],
  pep: [
    { id: 'PEP1', name: 'Ravi Kumar Sharma', alias: null, dob: '1990-05-15' },
    { id: 'PEP2', name: 'Ravi Kumar Sharma', alias: null, dob: '1960-01-01' },
  ],
};
const only = (sanctions: typeof lists.sanctions, pep: typeof lists.pep = []) =>
  run({ lists: { sanctions, pep } });

describe('R10 SANCTIONS_MATCH (REJECT) and R15 SANCTIONS_POSSIBLE_MATCH (REVIEW)', () => {
  it('MATCH: same name and equal dob -> reject', () => {
    const e = only([at(lists.sanctions, 0)]);
    expect(codes(e)).toEqual(['SANCTIONS_MATCH']);
    expect(e.decision).toBe('REJECT');
    expect(e.riskCategory).toBeNull();
    expect(e.screening.sanctions.hits[0]).toMatchObject({
      entryId: 'SAN1',
      matchedOn: 'name',
      similarity: 1,
      dobEqual: true,
      result: 'MATCH',
    });
  });
  it('MATCH: an entry with an empty dob matches on the name alone, and on the alias', () => {
    expect(codes(only([{ id: 'X', name: 'Ravi Kumar Sharma', alias: null, dob: null }]))).toEqual([
      'SANCTIONS_MATCH',
    ]);
    expect(only([at(lists.sanctions, 1)]).screening.sanctions.hits[0]).toMatchObject({
      matchedOn: 'alias',
      matchedText: 'Sharma Ravi Kumar',
    });
  });
  it('POSSIBLE: same name but a different dob -> review, risk HIGH', () => {
    const e = only([at(lists.sanctions, 2)]);
    expect(codes(e)).toEqual(['SANCTIONS_POSSIBLE_MATCH']);
    expect(e.decision).toBe('REVIEW');
    expect(e.riskCategory).toBe('HIGH');
    expect(e.screening.sanctions.hits[0]).toMatchObject({ dobEqual: false, result: 'POSSIBLE' });
  });
  it('POSSIBLE: similarity from 0.80 up to 0.90 whatever the dob', () => {
    const e = only([at(lists.sanctions, 3)]); // one character off in 15 -> 0.9333? checked below
    expect(e.screening.sanctions.hits[0]?.similarity).toBeGreaterThanOrEqual(0.9);
  });
  it('POSSIBLE band: 0.80 <= similarity < 0.90', () => {
    const e = run({
      app: { fullName: 'Abcdefghij' },
      lists: {
        sanctions: [{ id: 'B', name: 'Abcdefghxx', alias: null, dob: '1990-05-15' }],
        pep: [],
      },
    }); // 0.80
    expect(e.screening.sanctions.hits[0]).toMatchObject({ result: 'POSSIBLE' });
    expect(codes(e)).toContain('SANCTIONS_POSSIBLE_MATCH');
  });
  it('a clearly different name is not a hit', () => {
    expect(only([at(lists.sanctions, 4)]).screening.sanctions.result).toBe('NONE');
  });
  it('a MATCH wins over a POSSIBLE in the same list', () => {
    expect(only([at(lists.sanctions, 2), at(lists.sanctions, 0)]).screening.sanctions.result).toBe(
      'MATCH',
    );
  });
  it('thresholds come from the configuration', () => {
    const e = run({
      lists: { sanctions: [at(lists.sanctions, 0)], pep: [] },
      config: { watchlist_match_threshold: 1.1 },
    });
    expect(e.screening.sanctions.result).toBe('POSSIBLE'); // 1.0 < 1.1 but >= 0.80
  });
});

describe('R16 PEP_MATCH (REVIEW)', () => {
  it('fires on a PEP MATCH and makes the risk HIGH', () => {
    const e = only([], [at(lists.pep, 0)]);
    expect(codes(e)).toEqual(['PEP_MATCH']);
    expect(e.riskCategory).toBe('HIGH');
    expect(e.rekycDueDate).toBe('2028-03-04');
  });
  it('a PEP POSSIBLE result triggers nothing (the spec defines no rule for it)', () => {
    const e = only([], [at(lists.pep, 1)]);
    expect(e.screening.pep.result).toBe('POSSIBLE');
    expect(codes(e)).toEqual([]);
    expect(e.riskCategory).toBe('LOW');
  });
});

describe('R17 DUPLICATE_CUSTOMER (REVIEW)', () => {
  it('fires when the declared PAN is already a customer', () => {
    const e = run({ customers: [{ customerId: 'KB1', panNumber: 'ZZKPS1234Q' }] });
    expect(codes(e)).toEqual(['DUPLICATE_CUSTOMER']);
    expect(e.decision).toBe('REVIEW');
  });
  it('is quiet for a new PAN', () =>
    expect(codes(run({ customers: [{ customerId: 'KB1', panNumber: 'ZZXPS9999Q' }] }))).toEqual(
      [],
    ));
  it('the supplied customer list is used', () => {
    const existing = at(reference.existingCustomers, 0);
    const docs = [withField(pan(), 'pan_number', existing.panNumber), aadhaar(), bill()];
    expect(
      codes(
        run({
          app: { panNumber: existing.panNumber },
          docs,
          customers: reference.existingCustomers,
        }),
      ),
    ).toEqual(['DUPLICATE_CUSTOMER']);
  });
});

describe('precedence, order and outputs', () => {
  it('evaluates every rule (no short-circuit) and reports codes in rule order', () => {
    const e = run({
      app: { dob: '2008-09-10', panNumber: 'ZZKCS1234Q' },
      docs: [
        withField(withField(pan(), 'pan_number', 'ZZMPN3465S'), 'dob', '2008-09-10'),
        withField(aadhaar({ declaredDocType: 'BANK_STATEMENT' }), 'dob', '2008-09-10'),
        withField(bill(), 'document_date', '2025-01-01'),
      ],
      customers: [{ customerId: 'KB1', panNumber: 'ZZKCS1234Q' }],
    });
    expect(codes(e)).toEqual([
      'DOCUMENT_TYPE_MISMATCH',
      'AGE_BELOW_18',
      'PAN_INVALID',
      'PAN_MISMATCH',
      'ADDRESS_PROOF_STALE',
      'DUPLICATE_CUSTOMER',
    ]);
    expect(e.trace).toHaveLength(17);
    expect(e.trace.map((t) => t.rule)).toEqual(Array.from({ length: 17 }, (_, i) => `R${i + 1}`));
  });
  it('REJECT beats REVIEW and leaves risk and re-KYC empty, but still reports the score', () => {
    const e = run({
      app: { dob: '2008-09-10' },
      docs: [
        withField(pan(), 'dob', '2008-09-10'),
        withField(aadhaar(), 'dob', '2008-09-10'),
        withField(bill(), 'document_date', '2025-01-01'),
      ],
    });
    expect(e.decision).toBe('REJECT');
    expect(e.reasonCodes).toEqual(['AGE_BELOW_18', 'ADDRESS_PROOF_STALE']);
    expect(e.riskCategory).toBeNull();
    expect(e.rekycDueDate).toBeNull();
    expect(e.nameMatchScore).toBe(1);
  });
  it('REVIEW when only review rules fire; APPROVE (no codes) when none do', () => {
    expect(run({ customers: [{ customerId: 'K', panNumber: baseApp.panNumber }] }).decision).toBe(
      'REVIEW',
    );
    const clean = run();
    expect(clean).toMatchObject({
      decision: 'APPROVE',
      reasonCodes: [],
      riskCategory: 'LOW',
      rekycDueDate: '2036-03-04',
    });
  });
  it('the trace records the values compared for every rule', () => {
    const e = run({ docs: [withField(pan(), 'pan_number', 'ZZMPN3465S'), aadhaar(), bill()] });
    expect(traceOf(e, 'R6')).toMatchObject({
      status: 'TRIGGERED',
      code: 'PAN_MISMATCH',
      outcome: 'REJECT',
      compared: { declared: 'ZZKPS1234Q', onCard: 'ZZMPN3465S' },
    });
    expect(traceOf(e, 'R4')).toMatchObject({
      status: 'PASSED',
      compared: { ageYears: 35, minAge: 18 },
    });
  });
  it('the lowest doc_id of each type is the one used', () => {
    const second = withField(pan({ docId: 'D0' }), 'pan_number', 'ZZMPN3465S'); // D0 < D1: this card is the one used
    expect(codes(run({ docs: [pan(), second, aadhaar(), bill()] }))).toEqual(['PAN_MISMATCH']);
  });
});

describe('risk category and re-KYC date', () => {
  const risk = (app: Partial<typeof baseApp>) => run({ app });
  it('LOW: low-risk occupation and income under 25 lakh', () =>
    expect(risk({})).toMatchObject({ riskCategory: 'LOW', rekycDueDate: '2036-03-04' }));
  it('MEDIUM by occupation', () =>
    expect(risk({ occupationCode: 'SELF_EMPLOYED' })).toMatchObject({
      riskCategory: 'MEDIUM',
      rekycDueDate: '2034-03-04',
    }));
  it('MEDIUM by income, exactly at the threshold', () => {
    expect(risk({ annualIncome: 2_500_000 }).riskCategory).toBe('MEDIUM');
    expect(risk({ annualIncome: 2_499_999 }).riskCategory).toBe('LOW');
  });
  it('HIGH by occupation (example 10) with a 2-year re-KYC', () =>
    expect(risk({ occupationCode: 'JEWELLER_BULLION_DEALER' })).toMatchObject({
      riskCategory: 'HIGH',
      rekycDueDate: '2028-03-04',
    }));
  it('HIGH wins over MEDIUM', () =>
    expect(risk({ occupationCode: 'MONEY_CHANGER', annualIncome: 9_999_999 }).riskCategory).toBe(
      'HIGH',
    ));
  it('re-KYC periods come from the configuration', () => {
    expect(run({ config: { rekyc_years: { HIGH: 1, MEDIUM: 3, LOW: 5 } } }).rekycDueDate).toBe(
      '2031-03-04',
    );
  });
  it('29 February moves to 28 February when the target year has none', () => {
    expect(
      run({
        app: { applicationDate: '2024-02-29', dob: '1990-05-15' },
        docs: [pan(), aadhaar(), withField(bill(), 'document_date', '2024-02-01')],
      }).rekycDueDate,
    ).toBe('2034-02-28');
    expect(
      run({
        app: { applicationDate: '2024-02-29', occupationCode: 'MONEY_CHANGER' },
        docs: [pan(), aadhaar(), withField(bill(), 'document_date', '2024-02-01')],
      }).rekycDueDate,
    ).toBe('2026-02-28');
  });
  it('an unknown occupation is an error, not a guess', () =>
    expect(() => risk({ occupationCode: 'ASTRONAUT' })).toThrow(/unknown occupation_code/));
});

describe('configuration comes from the supplied file', () => {
  it('holds the values of spec section 6.1', () => {
    expect(reference.config).toMatchObject({
      min_field_confidence: 0.8,
      min_age: 18,
      name_match_threshold: 0.9,
      name_reject_below: 0.75,
      watchlist_match_threshold: 0.9,
      watchlist_possible_threshold: 0.8,
      address_proof_max_age_days: 90,
      medium_risk_income: 2500000,
      rekyc_years: { HIGH: 2, MEDIUM: 8, LOW: 10 },
      pan_pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$',
      pan_holder_type_char: 'P',
    });
    expect(reference.watchlists.sanctions).toHaveLength(50);
    expect(reference.watchlists.pep).toHaveLength(60);
    expect(reference.existingCustomers).toHaveLength(300);
  });
});
