// Shapes of the backend responses used by the screens (see the API contract in the README).
export type Role = 'APPLICANT' | 'KYC_OFFICER' | 'COMPLIANCE_OFFICER';
export const STATUSES = [
  'SUBMITTED',
  'EXTRACTING',
  'AUTO_APPROVED',
  'IN_REVIEW',
  'RESUBMISSION_REQUESTED',
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'AUTO_REJECTED',
  'CLOSED_EXPIRED',
] as const;
export type ApplicationStatus = (typeof STATUSES)[number];
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Decision = 'APPROVE' | 'REVIEW' | 'REJECT';

export interface ListItem {
  application_id: string;
  application_date: string;
  status: ApplicationStatus;
  full_name: string;
  pan_masked: string;
  occupation_code: string;
  created_at: string;
  resubmission_deadline: string | null;
}

export interface QueueItem extends ListItem {
  decision: Decision | null;
  risk_category: RiskLevel | null;
  reason_codes: string[];
  waiting_since: string;
}

export interface DocumentMeta {
  doc_id: string;
  file_name: string;
  declared_doc_type: string;
  size_bytes: number;
}

export interface TimelineEntry {
  status: ApplicationStatus;
  at: string;
  actor_role?: string;
}

interface Declared extends ListItem {
  dob: string;
  gender: string;
  aadhaar_masked: string;
  aadhaar_last4: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  annual_income: number;
  submission_round: number;
}

/** What an applicant sees: status, plain-language reasons and a timeline. No scores, codes or watchlist data. */
export interface ApplicantApplication extends Declared {
  documents: DocumentMeta[];
  reasons: string[];
  timeline: TimelineEntry[];
}

export interface ExtractedFieldView {
  field_name: string;
  value: string;
  confidence: number;
  source: 'EXTRACTOR' | 'OFFICER';
}

export interface StaffDocument extends DocumentMeta {
  extracted_fields: ExtractedFieldView[];
}

export interface TraceEntry {
  rule: string;
  code: string;
  outcome: 'REVIEW' | 'REJECT';
  status: 'TRIGGERED' | 'PASSED' | 'SKIPPED';
  skippedBecause?: string;
  compared?: Record<string, unknown>;
}

export interface ScreeningView {
  list_type: 'SANCTIONS' | 'PEP';
  entry_id: string;
  matched_name: string;
  similarity: number;
  result: 'MATCH' | 'POSSIBLE';
}

export interface EvaluationView {
  decision: Decision;
  reason_codes: string[];
  name_match_score: number | null;
  risk_category: RiskLevel | null;
  rekyc_due_date: string | null;
  trace: TraceEntry[];
  triggered_at: string;
  screening: ScreeningView[];
}

export interface StaffApplication extends Declared {
  pan_number: string;
  version: number;
  rekyc_due_date: string | null;
  thresholds: { min_field_confidence: number };
  timeline: TimelineEntry[];
  documents: StaffDocument[];
  evaluation: EvaluationView | null;
  recommendations: {
    id: string;
    recommendation: string;
    comment: string;
    officer: string;
    created_at: string;
  }[];
  checker_decisions: {
    id: string;
    action: string;
    comment: string;
    checker: string;
    created_at: string;
  }[];
}

export interface DocumentText {
  doc_id: string;
  file_name: string;
  declared_doc_type: string;
  sha256: string;
  text: string;
}

export interface UploadedDocument {
  doc_id: string;
  file_name: string;
  declared_doc_type: string;
  sha256: string;
  size_bytes: number;
  duplicate: boolean;
}

export interface Occupation {
  code: string;
  description: string;
}

export interface Dashboard {
  range: { from: string | null; to: string | null };
  total_applications: number;
  by_status: Record<ApplicationStatus, number>;
  decided: { count: number; approve: number; review: number; reject: number };
  rates: { straight_through: number | null; review: number | null; reject: number | null };
  top_reason_codes: { code: string; count: number }[];
  review_time: { average_seconds: number | null; completed_reviews: number; open_reviews: number };
  pending_checker: { count: number; overdue: number; sla_hours: number };
  definitions: Record<string, string>;
}

export interface AuditEventView {
  id: string;
  type: string;
  at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string;
  doc_id: string | null;
  before: unknown;
  after: unknown;
  details: unknown;
}

export interface Ratio {
  correct: number;
  total: number;
  rate: number | null;
}

export interface ClassifierMetrics {
  classification: {
    overall: Ratio;
    clean: Ratio;
    poor: Ratio;
    confusion: Record<string, Record<string, number>>;
    accurateWhenConfident: Ratio;
  };
  fields: {
    overall: Ratio;
    clean: Ratio;
    poor: Ratio;
    byField: Record<string, Ratio>;
    cleanByField: Record<string, Ratio>;
    poorByField: Record<string, Ratio>;
  };
  confidence: {
    threshold: number;
    accepted: Ratio;
    sentToReview: Ratio;
    coverage: Ratio;
    correctSentToReview: number;
  };
}

export interface AiEvaluation {
  metrics: {
    extractorVersion: string;
    rulesEngineVersion: string;
    sample: {
      documents: number;
      applications: number;
      declared: ClassifierMetrics;
      keywordRule: ClassifierMetrics;
      regexOnly: { label: string; metrics: ClassifierMetrics };
      ai: { label: string; metrics: ClassifierMetrics };
      mockVsExpected: { checked: number; mismatches: unknown[] };
      aiVsExpected: { checked: number; applicationsDiffering: string[] };
    };
    evaluation: {
      applications: number;
      documents: number;
      mockDecisionCounts: Record<string, number>;
      aiDecisionCounts: Record<string, number>;
      aiVsMockDecisionAgreement: Ratio;
      docTypeAgreementWithMock: Ratio;
      fieldAgreementWithMock: Ratio;
      injection: {
        docId: string;
        applicationId: string;
        aiDocType: string;
        mockDocType: string;
        keywordRuleDocType: string;
        decisionWithAi: string;
        aiWarnings: string[];
      } | null;
    };
  };
  report_markdown: string;
  model_card_markdown: string;
  files: { name: string; bytes: number; sha256: string }[];
}
