// Types of the pure rules engine. No database, HTTP or AI is involved: the engine is a function
//   evaluate(application, documents, config, watchlists, existingCustomers) -> Evaluation
// and the REST API, the batch command and the tests all call that same function.
import type { z } from 'zod';
import type { rulesConfig } from '../import/rows.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Decision = 'APPROVE' | 'REVIEW' | 'REJECT';

/** The 17 reason codes of spec 6.1, in rule order. */
export const REASON_CODES = [
  'DOCUMENT_MISSING', // R1
  'DOCUMENT_TYPE_MISMATCH', // R2
  'LOW_EXTRACTION_CONFIDENCE', // R3
  'AGE_BELOW_18', // R4
  'PAN_INVALID', // R5
  'PAN_MISMATCH', // R6
  'DOB_MISMATCH', // R7
  'AADHAAR_MISMATCH', // R8
  'NAME_MISMATCH', // R9
  'SANCTIONS_MATCH', // R10
  'NAME_MISMATCH_MINOR', // R11
  'DOCUMENT_EXPIRED', // R12
  'ADDRESS_PROOF_STALE', // R13
  'ADDRESS_MISMATCH', // R14
  'SANCTIONS_POSSIBLE_MATCH', // R15
  'PEP_MATCH', // R16
  'DUPLICATE_CUSTOMER', // R17
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Everything in the thresholds/patterns file, plus the occupation risk table (data, not code). */
export type EngineConfig = z.output<typeof rulesConfig> & {
  occupations: Record<string, RiskLevel>;
};

export interface ApplicationInput {
  applicationId: string;
  applicationDate: string; // YYYY-MM-DD
  fullName: string;
  dob: string; // YYYY-MM-DD
  panNumber: string;
  aadhaarLast4: string;
  pincode: string;
  occupationCode: string;
  annualIncome: number;
}

export interface FieldValue {
  name: string;
  value: string;
  confidence: number; // 0 to 1; an officer-corrected field has 1.00
}

/** One uploaded document after extraction. The extractor proposes; it never decides. */
export interface ClassifiedDocument {
  docId: string;
  declaredDocType: string;
  docType: string; // as classified by the extraction service
  docTypeConfidence: number;
  fields: FieldValue[];
}

export interface WatchlistEntry {
  id: string;
  name: string;
  alias: string | null;
  dob: string | null; // null = name-only entry
}

export interface Watchlists {
  sanctions: WatchlistEntry[];
  pep: WatchlistEntry[];
}

export interface ExistingCustomer {
  customerId: string;
  panNumber: string;
}

export type ScreeningResult = 'MATCH' | 'POSSIBLE' | 'NONE';

export interface ScreeningHit {
  entryId: string;
  matchedOn: 'name' | 'alias';
  matchedText: string;
  similarity: number;
  entryDob: string | null;
  declaredDob: string;
  dobEqual: boolean | null; // null when the entry has no dob
  result: 'MATCH' | 'POSSIBLE';
}

export interface Screening {
  result: ScreeningResult;
  hits: ScreeningHit[];
}

/** What one rule reports. `skipped` explains why it was not evaluated (field not usable, not applicable). */
export interface RuleOutcome {
  triggered: boolean;
  skipped?: string;
  compared?: Record<string, unknown>;
}

export interface TraceEntry {
  rule: string;
  code: ReasonCode;
  outcome: 'REVIEW' | 'REJECT';
  status: 'TRIGGERED' | 'PASSED' | 'SKIPPED';
  skippedBecause?: string;
  compared?: Record<string, unknown>;
}

export interface Evaluation {
  decision: Decision;
  reasonCodes: ReasonCode[];
  nameMatchScore: number | null; // full precision; round to 4 decimals only for output
  riskCategory: RiskLevel | null; // null for REJECT
  rekycDueDate: string | null; // null for REJECT
  trace: TraceEntry[];
  screening: { sanctions: Screening; pep: Screening };
}
