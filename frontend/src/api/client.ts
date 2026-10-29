import { apiDownload, apiFetch } from './http';
import type {
  AiEvaluation,
  ApplicantApplication,
  AuditEventView,
  Dashboard,
  DocumentMeta,
  DocumentText,
  ListItem,
  Occupation,
  QueueItem,
  StaffApplication,
  UploadedDocument,
} from './types';

const V1 = '/api/v1';
const enc = encodeURIComponent;

export interface NewApplicationInput {
  full_name: string;
  dob: string;
  gender: 'M' | 'F';
  pan_number: string;
  aadhaar_last4: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  occupation_code: string;
  annual_income: number;
  consent_kyc: boolean;
}

export const listMine = () => apiFetch<{ applications: ListItem[] }>(`${V1}/applications/mine`);
export const getOccupations = () =>
  apiFetch<{ occupations: Occupation[] }>(`${V1}/reference/occupations`);
export const createApplication = (input: NewApplicationInput) =>
  apiFetch<{ application_id: string; status: string }>(`${V1}/applications`, {
    method: 'POST',
    body: input,
  });
export const getApplicantApplication = (id: string) =>
  apiFetch<ApplicantApplication>(`${V1}/applications/${enc(id)}`);
export const getStaffApplication = (id: string) =>
  apiFetch<StaffApplication>(`${V1}/applications/${enc(id)}`);
export const listDocuments = (id: string) =>
  apiFetch<{ documents: DocumentMeta[] }>(`${V1}/applications/${enc(id)}/documents`);
export const getDocumentText = (id: string, docId: string) =>
  apiFetch<DocumentText>(`${V1}/applications/${enc(id)}/documents/${enc(docId)}`);

export function uploadDocuments(id: string, files: { file: File; declaredType: string }[]) {
  const form = new FormData();
  for (const f of files) form.append('files', f.file, f.file.name);
  for (const f of files) form.append('declared_doc_type', f.declaredType);
  return apiFetch<{ documents: UploadedDocument[] }>(`${V1}/applications/${enc(id)}/documents`, {
    method: 'POST',
    form,
  });
}

export const submitApplication = (id: string) =>
  apiFetch<{ application_id: string; status: string }>(`${V1}/applications/${enc(id)}/submit`, {
    method: 'POST',
  });
export const resubmitApplication = (id: string) =>
  apiFetch<{ application_id: string; status: string }>(`${V1}/applications/${enc(id)}/resubmit`, {
    method: 'POST',
  });

export const getQueue = () =>
  apiFetch<{ queue: string; applications: QueueItem[] }>(`${V1}/review/queue`);

export interface CorrectionInput {
  doc_id: string;
  field_name: string;
  new_value: string;
  reason: string;
}
export const submitCorrections = (id: string, corrections: CorrectionInput[]) =>
  apiFetch<{ status: string; decision: string }>(`${V1}/applications/${enc(id)}/corrections`, {
    method: 'POST',
    body: { corrections },
  });
export const submitRecommendation = (
  id: string,
  body: { recommendation: string; comment: string },
) =>
  apiFetch<{ status: string }>(`${V1}/applications/${enc(id)}/recommendation`, {
    method: 'POST',
    body,
  });
export const submitCheckerDecision = (id: string, body: { action: string; comment: string }) =>
  apiFetch<{ status: string; account?: { customer_id: string; account_number: string } }>(
    `${V1}/applications/${enc(id)}/checker-decision`,
    { method: 'POST', body },
  );

export const getDashboard = (range: { from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (range.from) q.set('from', range.from);
  if (range.to) q.set('to', range.to);
  return apiFetch<Dashboard>(`${V1}/admin/dashboard${q.size ? `?${q}` : ''}`);
};
export const getAudit = (applicationId: string) =>
  apiFetch<{ events: AuditEventView[] }>(`${V1}/admin/audit/${enc(applicationId)}`);
export const downloadAuditCsv = (applicationId: string) =>
  apiDownload(`${V1}/admin/audit/${enc(applicationId)}?format=csv`);
export const getAiEvaluation = () => apiFetch<AiEvaluation>(`${V1}/admin/ai-evaluation`);

// Compliance maintenance (spec section 3: watchlists and rule configuration; FR-8 expiry; re-KYC; re-screening).
export type RuleConfig = Record<string, unknown> & { version: string };
export interface SanctionsEntry {
  list_id: string;
  name: string;
  alias: string;
  dob: string | null;
  nationality: string;
  program: string;
}
export interface PepEntry {
  pep_id: string;
  name: string;
  dob: string | null;
  position: string;
  category: string;
}
export interface RescreenResult {
  rescreened: number;
  changed: {
    application_id: string;
    status: string;
    before: { decision: string; reason_codes: string[] } | null;
    after: { decision: string; reason_codes: string[] };
  }[];
  failures: unknown[];
}
export const getRuleConfig = () =>
  apiFetch<{ id: string; version: string; loaded_at: string; config: RuleConfig }>(
    `${V1}/admin/rule-config`,
  );
export const putRuleConfig = (config: RuleConfig) =>
  apiFetch<{ id: string; version: string }>(`${V1}/admin/rule-config`, {
    method: 'PUT',
    body: config,
  });
export const listSanctions = () =>
  apiFetch<{ entries: SanctionsEntry[] }>(`${V1}/admin/watchlists/sanctions`);
export const addSanctions = (e: Record<string, string>) =>
  apiFetch<{ list_id: string }>(`${V1}/admin/watchlists/sanctions`, { method: 'POST', body: e });
export const removeSanctions = (id: string) =>
  apiFetch<undefined>(`${V1}/admin/watchlists/sanctions/${enc(id)}`, { method: 'DELETE' });
export const listPep = () => apiFetch<{ entries: PepEntry[] }>(`${V1}/admin/watchlists/pep`);
export const addPep = (e: Record<string, string>) =>
  apiFetch<{ pep_id: string }>(`${V1}/admin/watchlists/pep`, { method: 'POST', body: e });
export const removePep = (id: string) =>
  apiFetch<undefined>(`${V1}/admin/watchlists/pep/${enc(id)}`, { method: 'DELETE' });
export const rescreen = () => apiFetch<RescreenResult>(`${V1}/admin/rescreen`, { method: 'POST' });
export const expireOverdue = () =>
  apiFetch<{ expired: string[] }>(`${V1}/admin/expire-overdue`, { method: 'POST' });
export const getRekycDue = (days: number) =>
  apiFetch<{
    days: number;
    customers: {
      application_id: string;
      full_name: string;
      status: string;
      rekyc_due_date: string | null;
    }[];
  }>(`${V1}/admin/rekyc-due?days=${days}`);

export interface AiSummary {
  label: 'AI-generated';
  application_id: string;
  summary: string;
  words: number;
  model: string;
  prompt_version: string;
  generated_at: string;
}
export const getAiSummary = (id: string) =>
  apiFetch<AiSummary>(`${V1}/applications/${enc(id)}/ai-summary`);
export const processReceived = () =>
  apiFetch<{ processed: number; by_status: Record<string, number>; skipped: string[] }>(
    `${V1}/admin/process-received`,
    { method: 'POST' },
  );
