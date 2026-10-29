// Workflow STATUS is not the engine's DECISION. This only says where a freshly decided case goes
// (spec 6.1.2 "Routing"); the status machine itself lives in modules/workflow.
import type { ApplicationStatus } from '@prisma/client';
import type { Decision, RiskLevel } from './types.js';

export function routeStatus(decision: Decision, risk: RiskLevel | null): ApplicationStatus {
  if (decision === 'REJECT') return 'AUTO_REJECTED';
  if (decision === 'REVIEW') return 'IN_REVIEW';
  return risk === 'HIGH' ? 'PENDING_CHECKER' : 'AUTO_APPROVED'; // a HIGH-risk approval still needs a checker
}
