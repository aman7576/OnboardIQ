// Allowed status changes, copied from the lifecycle table in spec 6.1.1 ("Next statuses").
import type { ApplicationStatus } from '@prisma/client';
import { conflict } from '../../http/errors.js';

export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  SUBMITTED: ['EXTRACTING'],
  EXTRACTING: ['AUTO_APPROVED', 'PENDING_CHECKER', 'IN_REVIEW', 'AUTO_REJECTED'],
  AUTO_APPROVED: [],
  IN_REVIEW: ['PENDING_CHECKER', 'RESUBMISSION_REQUESTED'],
  RESUBMISSION_REQUESTED: ['SUBMITTED', 'CLOSED_EXPIRED'],
  PENDING_CHECKER: ['APPROVED', 'REJECTED', 'IN_REVIEW'],
  APPROVED: [],
  REJECTED: [],
  AUTO_REJECTED: [],
  CLOSED_EXPIRED: [],
};

export const canTransition = (from: ApplicationStatus, to: ApplicationStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to))
    throw conflict('INVALID_TRANSITION', `A case in ${from} cannot move to ${to}`);
}
