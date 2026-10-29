// The decision API response (spec section 6.3): application_id, decision, reason_codes, name_match_score,
// risk_category, rekyc_due_date, status, and per document its doc_type and confidence.
import type { ApplicationStatus } from '@prisma/client';
import { roundScore } from './name.js';
import { routeStatus } from './routing.js';
import type { ClassifiedDocument, Evaluation } from './types.js';

/**
 * `status` defaults to where the decision routes a new case. Pass the case's real status when it is already
 * known (for example after an officer correction: the case goes to the checker whatever the new decision says).
 */
export function toDecisionResponse(
  applicationId: string,
  evaluation: Evaluation,
  documents: ClassifiedDocument[],
  currentStatus?: ApplicationStatus,
) {
  const status: ApplicationStatus =
    currentStatus ?? routeStatus(evaluation.decision, evaluation.riskCategory);
  return {
    application_id: applicationId,
    decision: evaluation.decision,
    reason_codes: evaluation.reasonCodes,
    name_match_score:
      evaluation.nameMatchScore === null ? null : roundScore(evaluation.nameMatchScore),
    risk_category: evaluation.riskCategory,
    rekyc_due_date: evaluation.rekycDueDate,
    status,
    documents: documents.map((d) => ({
      doc_id: d.docId,
      doc_type: d.docType,
      confidence: d.docTypeConfidence,
    })),
  };
}
