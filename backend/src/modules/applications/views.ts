// What each audience may see. Applicants never receive confidence scores, screening results or
// other people's data; lists never carry a full PAN.
import type {
  Application,
  CheckerDecision,
  Document,
  ExtractedField,
  OfficerRecommendation,
  RuleEvaluation,
  ScreeningMatch,
  User,
} from '@prisma/client';
import { maskAadhaar, maskPan } from './masking.js';

const day = (d: Date): string => d.toISOString().slice(0, 10);

export const toListItem = (a: Application) => ({
  application_id: a.application_id,
  application_date: day(a.application_date),
  status: a.status,
  full_name: a.full_name,
  pan_masked: maskPan(a.pan_number),
  occupation_code: a.occupation_code,
  created_at: a.created_at.toISOString(),
  resubmission_deadline: a.resubmission_deadline?.toISOString() ?? null,
});

const declared = (a: Application) => ({
  ...toListItem(a),
  dob: day(a.dob),
  gender: a.gender,
  aadhaar_masked: maskAadhaar(a.aadhaar_last4),
  aadhaar_last4: a.aadhaar_last4,
  mobile: a.mobile,
  email: a.email,
  address: a.address,
  city: a.city,
  state: a.state,
  pincode: a.pincode,
  annual_income: a.annual_income,
  submission_round: a.submission_round,
  resubmission_deadline: a.resubmission_deadline?.toISOString() ?? null,
});

const documentMeta = (
  d: Pick<Document, 'doc_id' | 'file_name' | 'declared_doc_type' | 'size_bytes'>,
) => ({
  doc_id: d.doc_id,
  file_name: d.file_name,
  declared_doc_type: d.declared_doc_type,
  size_bytes: d.size_bytes,
});

export const toDocumentList = (docs: Parameters<typeof documentMeta>[0][]) =>
  docs.map(documentMeta);

export interface TimelineEntry {
  status: string;
  at: string;
  actor_role?: string;
}

export const toApplicantView = (
  a: Application,
  docs: Parameters<typeof documentMeta>[0][],
  extras: { reasons: string[]; timeline: TimelineEntry[] },
) => ({
  ...declared(a),
  documents: toDocumentList(docs),
  reasons: extras.reasons, // plain language; never codes, scores or watchlist details
  timeline: extras.timeline,
});

export interface StaffInput {
  application: Application;
  documents: (Document & { extractions: { fields: ExtractedField[] }[] })[];
  recommendations: (OfficerRecommendation & { officer: Pick<User, 'display_name'> })[];
  checker_actions: (CheckerDecision & { checker: Pick<User, 'display_name'> })[];
  evaluation: (RuleEvaluation & { screening: ScreeningMatch[] }) | null;
  thresholds: { min_field_confidence: number };
  timeline: TimelineEntry[];
}

export const toStaffView = ({
  application,
  documents,
  recommendations,
  checker_actions,
  evaluation,
  thresholds,
  timeline,
}: StaffInput) => ({
  thresholds, // taken from the active rule configuration: the screen never hard-codes the confidence limit
  ...declared(application),
  timeline,
  pan_number: application.pan_number, // full PAN only on the case screen, never in lists or exports
  version: application.version,
  rekyc_due_date: application.rekyc_due_date ? day(application.rekyc_due_date) : null,
  documents: documents.map((d) => ({
    ...documentMeta(d),
    extracted_fields: d.extractions.flatMap((e) =>
      e.fields.map((f) => ({
        field_name: f.field_name,
        value: f.value,
        confidence: Number(f.confidence),
        source: f.source,
      })),
    ),
  })),
  evaluation: evaluation && {
    decision: evaluation.decision,
    reason_codes: evaluation.reason_codes,
    name_match_score: evaluation.name_match_score,
    risk_category: evaluation.risk_category,
    rekyc_due_date: evaluation.rekyc_due_date && day(evaluation.rekyc_due_date),
    // Explainability: every rule with the values it compared.
    trace: evaluation.trace,
    triggered_at: evaluation.created_at.toISOString(),
    screening: evaluation.screening.map((s) => ({
      list_type: s.list_type,
      entry_id: s.entry_id,
      matched_name: s.matched_name,
      similarity: s.similarity,
      result: s.result,
    })),
  },
  recommendations: recommendations.map((r) => ({
    id: r.id,
    recommendation: r.recommendation,
    comment: r.comment,
    officer: r.officer.display_name,
    created_at: r.created_at.toISOString(),
  })),
  checker_decisions: checker_actions.map((c) => ({
    id: c.id,
    action: c.action,
    comment: c.comment,
    checker: c.checker.display_name,
    created_at: c.created_at.toISOString(),
  })),
});
