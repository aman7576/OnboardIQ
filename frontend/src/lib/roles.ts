import type { Role } from '@/api/types';

export type { Role };

export const ROLE_LABEL: Record<Role, string> = {
  APPLICANT: 'Applicant',
  KYC_OFFICER: 'KYC Officer',
  COMPLIANCE_OFFICER: 'Compliance Officer',
};

// What each role does (spec section 3). The screens themselves arrive in later phases.
export const ROLE_TASKS: Record<Role, string> = {
  APPLICANT: 'Apply, upload documents, track status',
  KYC_OFFICER: 'Review queue, field correction, recommendation',
  COMPLIANCE_OFFICER: 'Checker decisions, dashboard, audit trail',
};

export const ROLES: Role[] = ['APPLICANT', 'KYC_OFFICER', 'COMPLIANCE_OFFICER'];
