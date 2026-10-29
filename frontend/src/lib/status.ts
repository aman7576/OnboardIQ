// Presentation only: how a status or risk is labelled and coloured. Nothing here decides anything.
import type { ApplicationStatus, Decision, RiskLevel } from '@/api/types';

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export const STATUS_META: Record<ApplicationStatus, { label: string; tone: Tone; hint: string }> = {
  SUBMITTED: { label: 'Submitted', tone: 'neutral', hint: 'Received, waiting to be processed' },
  EXTRACTING: { label: 'Processing', tone: 'info', hint: 'Documents are being read and checked' },
  AUTO_APPROVED: {
    label: 'Approved (automatic)',
    tone: 'success',
    hint: 'Approved automatically; account opened',
  },
  IN_REVIEW: { label: 'In review', tone: 'warning', hint: 'With a KYC officer' },
  RESUBMISSION_REQUESTED: {
    label: 'Documents requested',
    tone: 'warning',
    hint: 'New documents are needed from the applicant',
  },
  PENDING_CHECKER: {
    label: 'Awaiting checker',
    tone: 'info',
    hint: 'Waiting for a second person to approve',
  },
  APPROVED: { label: 'Approved', tone: 'success', hint: 'Approved by a checker; account opened' },
  REJECTED: { label: 'Rejected', tone: 'danger', hint: 'Rejected by a checker' },
  AUTO_REJECTED: { label: 'Rejected (by rules)', tone: 'danger', hint: 'Rejected by the rules' },
  CLOSED_EXPIRED: {
    label: 'Closed',
    tone: 'neutral',
    hint: 'Closed: no resubmission within the allowed time',
  },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: Tone }> = {
  LOW: { label: 'Low risk', tone: 'success' },
  MEDIUM: { label: 'Medium risk', tone: 'warning' },
  HIGH: { label: 'High risk', tone: 'danger' },
};

export const DECISION_META: Record<Decision, { label: string; tone: Tone }> = {
  APPROVE: { label: 'Approve', tone: 'success' },
  REVIEW: { label: 'Review', tone: 'warning' },
  REJECT: { label: 'Reject', tone: 'danger' },
};

export const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-forest-soft text-forest',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-amber-soft text-amber',
  info: 'bg-[#e3ecf4] text-[#1f4c73]',
  neutral: 'bg-ivory-deep text-ink-soft',
};
