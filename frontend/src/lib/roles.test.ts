import { describe, expect, it } from 'vitest';
import { ROLE_LABEL, ROLE_TASKS, ROLES } from './roles';

describe('roles', () => {
  it('has a label and a task description for every role in the spec', () => {
    expect(ROLES).toEqual(['APPLICANT', 'KYC_OFFICER', 'COMPLIANCE_OFFICER']);
    for (const role of ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_TASKS[role]).toBeTruthy();
    }
  });
});
