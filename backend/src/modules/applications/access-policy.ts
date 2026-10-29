// Object-level authorisation: which caller may see which application and its documents.
// Pure functions: no database, easy to unit-test. Role gates (403) live in the route layer.
import type { ApplicationStatus, Role } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';

// ASSUMPTION: a KYC Officer works cases that are in the review pipeline. Compliance Officers need
// the whole book for the dashboard and audit trail. Applicants only ever see their own application.
export const OFFICER_CASE_STATUSES: readonly ApplicationStatus[] = [
  'IN_REVIEW',
  'PENDING_CHECKER',
  'RESUBMISSION_REQUESTED',
];

export interface Ownable {
  applicant_user_id: string | null;
  status: ApplicationStatus;
}

export function canViewApplication(
  caller: Pick<AuthContext, 'userId' | 'role'>,
  app: Ownable,
): boolean {
  const roles: Record<Role, () => boolean> = {
    APPLICANT: () => app.applicant_user_id !== null && app.applicant_user_id === caller.userId,
    KYC_OFFICER: () => OFFICER_CASE_STATUSES.includes(app.status),
    COMPLIANCE_OFFICER: () => true,
  };
  return roles[caller.role]();
}

export const isStaff = (role: Role): boolean => role !== 'APPLICANT';
