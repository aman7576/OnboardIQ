import type { ApplicationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  TRANSITIONS,
} from '../../src/modules/workflow/transitions.js';

// Spec 6.1.1, "Next statuses" column, copied here independently of the implementation.
const SPEC: [ApplicationStatus, ApplicationStatus[]][] = [
  ['SUBMITTED', ['EXTRACTING']],
  ['EXTRACTING', ['AUTO_APPROVED', 'PENDING_CHECKER', 'IN_REVIEW', 'AUTO_REJECTED']],
  ['AUTO_APPROVED', []],
  ['IN_REVIEW', ['PENDING_CHECKER', 'RESUBMISSION_REQUESTED']],
  ['RESUBMISSION_REQUESTED', ['SUBMITTED', 'CLOSED_EXPIRED']],
  ['PENDING_CHECKER', ['APPROVED', 'REJECTED', 'IN_REVIEW']],
  ['APPROVED', []],
  ['REJECTED', []],
  ['AUTO_REJECTED', []],
  ['CLOSED_EXPIRED', []],
];

describe('status transitions', () => {
  it.each(SPEC)('%s may only move to %j', (from, next) => {
    expect([...TRANSITIONS[from]].sort()).toEqual([...next].sort());
  });

  it('covers every status exactly once', () => {
    expect(Object.keys(TRANSITIONS)).toHaveLength(SPEC.length);
  });

  it('refuses a move the lifecycle does not allow with a 409', () => {
    expect(canTransition('IN_REVIEW', 'APPROVED')).toBe(false);
    expect(() => assertTransition('IN_REVIEW', 'APPROVED')).toThrow(/cannot move/);
    expect(() => assertTransition('APPROVED', 'IN_REVIEW')).toThrow();
  });
});
