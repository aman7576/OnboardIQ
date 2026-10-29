import type { ApplicationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { canViewApplication } from '../../src/modules/applications/access-policy.js';

const app = (owner: string | null, status: ApplicationStatus) => ({
  applicant_user_id: owner,
  status,
});
const as = (role: 'APPLICANT' | 'KYC_OFFICER' | 'COMPLIANCE_OFFICER', userId = 'u1') => ({
  role,
  userId,
});

describe('canViewApplication', () => {
  it('lets an applicant see only their own application', () => {
    expect(canViewApplication(as('APPLICANT', 'u1'), app('u1', 'SUBMITTED'))).toBe(true);
    expect(canViewApplication(as('APPLICANT', 'u1'), app('u2', 'SUBMITTED'))).toBe(false);
    expect(canViewApplication(as('APPLICANT', 'u1'), app(null, 'SUBMITTED'))).toBe(false);
  });

  it.each(['IN_REVIEW', 'PENDING_CHECKER', 'RESUBMISSION_REQUESTED'] as const)(
    'lets a KYC officer see %s cases',
    (status) => expect(canViewApplication(as('KYC_OFFICER'), app('u9', status))).toBe(true),
  );

  it.each(['SUBMITTED', 'EXTRACTING', 'AUTO_APPROVED', 'AUTO_REJECTED', 'APPROVED'] as const)(
    'keeps %s cases away from a KYC officer',
    (status) => expect(canViewApplication(as('KYC_OFFICER'), app('u9', status))).toBe(false),
  );

  it('lets a compliance officer see every application', () => {
    expect(canViewApplication(as('COMPLIANCE_OFFICER'), app(null, 'AUTO_APPROVED'))).toBe(true);
  });
});
