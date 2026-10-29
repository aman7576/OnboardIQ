-- CreateEnum
CREATE TYPE "Dataset" AS ENUM ('SAMPLE', 'EVAL', 'LIVE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('APPLICANT', 'KYC_OFFICER', 'COMPLIANCE_OFFICER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "PepCategory" AS ENUM ('DOMESTIC', 'RCA');

-- CreateEnum
CREATE TYPE "DeclaredDocType" AS ENUM ('PAN_CARD', 'AADHAAR_CARD', 'ELECTRICITY_BILL', 'BANK_STATEMENT', 'DRIVING_LICENCE');

-- CreateEnum
CREATE TYPE "ExtractionProvider" AS ENUM ('MOCK', 'AI');

-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('EXTRACTOR', 'OFFICER');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('APPROVE', 'REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'EXTRACTING', 'AUTO_APPROVED', 'IN_REVIEW', 'RESUBMISSION_REQUESTED', 'PENDING_CHECKER', 'APPROVED', 'REJECTED', 'AUTO_REJECTED', 'CLOSED_EXPIRED');

-- CreateEnum
CREATE TYPE "EvaluationTrigger" AS ENUM ('SUBMISSION', 'FIELD_CORRECTION', 'RESUBMISSION', 'RESCREEN');

-- CreateEnum
CREATE TYPE "WatchlistType" AS ENUM ('SANCTIONS', 'PEP');

-- CreateEnum
CREATE TYPE "ScreeningResult" AS ENUM ('MATCH', 'POSSIBLE');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_RESUBMISSION');

-- CreateEnum
CREATE TYPE "CheckerAction" AS ENUM ('APPROVE', 'REJECT', 'SEND_BACK');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('STATUS_CHANGED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'EXTRACTION_RECORDED', 'FIELD_CORRECTED', 'DECISION_RECORDED', 'WATCHLIST_HIT', 'RECOMMENDATION_RECORDED', 'CHECKER_DECISION_RECORDED', 'ACCOUNT_OPENED', 'CONFIG_CHANGED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_config" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "source_file" TEXT NOT NULL,
    "source_sha256" CHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupations" (
    "occupation_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "source_row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "occupations_pkey" PRIMARY KEY ("occupation_code")
);

-- CreateTable
CREATE TABLE "sanctions_list" (
    "list_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "dob" DATE,
    "nationality" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "source_row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "sanctions_list_pkey" PRIMARY KEY ("list_id")
);

-- CreateTable
CREATE TABLE "pep_list" (
    "pep_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "position" TEXT NOT NULL,
    "category" "PepCategory" NOT NULL,
    "source_row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "pep_list_pkey" PRIMARY KEY ("pep_id")
);

-- CreateTable
CREATE TABLE "existing_customers" (
    "customer_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "pan_number" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "source_row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "existing_customers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "applications" (
    "application_id" TEXT NOT NULL,
    "dataset" "Dataset" NOT NULL,
    "application_date" DATE NOT NULL,
    "full_name" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "pan_number" TEXT NOT NULL,
    "aadhaar_last4" CHAR(4) NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "occupation_code" TEXT NOT NULL,
    "annual_income" INTEGER NOT NULL,
    "kyc_consent" BOOLEAN,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "applicant_user_id" UUID,
    "source_row_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("application_id")
);

-- CreateTable
CREATE TABLE "application_expected" (
    "application_id" TEXT NOT NULL,
    "expected_decision" TEXT NOT NULL,
    "expected_reason_codes" TEXT NOT NULL,
    "expected_name_match_score" TEXT NOT NULL,
    "expected_risk_category" TEXT NOT NULL,
    "expected_rekyc_due_date" TEXT NOT NULL,

    CONSTRAINT "application_expected_pkey" PRIMARY KEY ("application_id")
);

-- CreateTable
CREATE TABLE "documents" (
    "doc_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "declared_doc_type" "DeclaredDocType" NOT NULL,
    "text" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "dataset" "Dataset" NOT NULL,
    "uploaded_by" UUID,
    "source_row_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("doc_id")
);

-- CreateTable
CREATE TABLE "extractions" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "provider" "ExtractionProvider" NOT NULL,
    "extractor_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" UUID NOT NULL,
    "extraction_id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "source" "FieldSource" NOT NULL DEFAULT 'EXTRACTOR',
    "source_row_hash" CHAR(64),

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_truth" (
    "doc_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "name" TEXT,
    "dob" TEXT,
    "gender" TEXT,
    "pan_number" TEXT,
    "aadhaar_last4" TEXT,
    "address" TEXT,
    "pincode" TEXT,
    "document_date" TEXT,
    "valid_until" TEXT,
    "source_row_hash" CHAR(64) NOT NULL,

    CONSTRAINT "document_truth_pkey" PRIMARY KEY ("doc_id")
);

-- CreateTable
CREATE TABLE "field_corrections" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" TEXT,
    "old_confidence" DECIMAL(5,4),
    "new_value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_evaluations" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "trigger" "EvaluationTrigger" NOT NULL,
    "decision" "Decision" NOT NULL,
    "reason_codes" TEXT[],
    "name_match_score" DOUBLE PRECISION,
    "risk_category" "RiskLevel",
    "rekyc_due_date" DATE,
    "trace" JSONB NOT NULL,
    "rules_version" TEXT NOT NULL,
    "rule_config_id" INTEGER NOT NULL,
    "extraction_provider" "ExtractionProvider" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_matches" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "list_type" "WatchlistType" NOT NULL,
    "entry_id" TEXT NOT NULL,
    "matched_name" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "declared_dob" DATE NOT NULL,
    "entry_dob" DATE,
    "result" "ScreeningResult" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officer_recommendations" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "officer_id" UUID NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officer_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checker_decisions" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "checker_id" UUID NOT NULL,
    "recommendation_id" UUID,
    "action" "CheckerAction" NOT NULL,
    "comment" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checker_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_banking_accounts" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_banking_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" "AuditEventType" NOT NULL,
    "application_id" TEXT,
    "doc_id" TEXT,
    "actor_user_id" UUID,
    "actor_role" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" SERIAL NOT NULL,
    "dataset" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "rule_config_source_sha256_key" ON "rule_config"("source_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "existing_customers_pan_number_key" ON "existing_customers"("pan_number");

-- CreateIndex
CREATE INDEX "applications_dataset_status_idx" ON "applications"("dataset", "status");

-- CreateIndex
CREATE INDEX "applications_pan_number_idx" ON "applications"("pan_number");

-- CreateIndex
CREATE INDEX "applications_applicant_user_id_idx" ON "applications"("applicant_user_id");

-- CreateIndex
CREATE INDEX "documents_application_id_idx" ON "documents"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_application_id_sha256_key" ON "documents"("application_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "extractions_doc_id_provider_extractor_version_key" ON "extractions"("doc_id", "provider", "extractor_version");

-- CreateIndex
CREATE INDEX "extracted_fields_doc_id_idx" ON "extracted_fields"("doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_fields_extraction_id_field_name_key" ON "extracted_fields"("extraction_id", "field_name");

-- CreateIndex
CREATE INDEX "field_corrections_application_id_created_at_idx" ON "field_corrections"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "rule_evaluations_application_id_created_at_idx" ON "rule_evaluations"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "screening_matches_application_id_idx" ON "screening_matches"("application_id");

-- CreateIndex
CREATE INDEX "officer_recommendations_application_id_created_at_idx" ON "officer_recommendations"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "checker_decisions_application_id_created_at_idx" ON "checker_decisions"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "core_banking_accounts_application_id_key" ON "core_banking_accounts"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_banking_accounts_customer_id_key" ON "core_banking_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_banking_accounts_account_number_key" ON "core_banking_accounts"("account_number");

-- CreateIndex
CREATE INDEX "audit_events_application_id_id_idx" ON "audit_events"("application_id", "id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_occupation_code_fkey" FOREIGN KEY ("occupation_code") REFERENCES "occupations"("occupation_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_user_id_fkey" FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_expected" ADD CONSTRAINT "application_expected_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("doc_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_truth" ADD CONSTRAINT "document_truth_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("doc_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_corrections" ADD CONSTRAINT "field_corrections_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_corrections" ADD CONSTRAINT "field_corrections_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("doc_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_corrections" ADD CONSTRAINT "field_corrections_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_rule_config_id_fkey" FOREIGN KEY ("rule_config_id") REFERENCES "rule_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_matches" ADD CONSTRAINT "screening_matches_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "rule_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_matches" ADD CONSTRAINT "screening_matches_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_recommendations" ADD CONSTRAINT "officer_recommendations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officer_recommendations" ADD CONSTRAINT "officer_recommendations_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "officer_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_banking_accounts" ADD CONSTRAINT "core_banking_accounts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("application_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("doc_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written guards (not expressible in schema.prisma) ─────────────────────

-- FR-9: audit rows are append-only. No UPDATE or DELETE path exists, even with raw SQL.
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Privacy: only the last 4 Aadhaar digits may ever be stored (FR-2).
ALTER TABLE "applications" ADD CONSTRAINT applications_aadhaar_last4_4_digits
  CHECK (aadhaar_last4 ~ '^[0-9]{4}$');

-- Section 3: officer recommendation needs a comment of at least 10 characters.
ALTER TABLE "officer_recommendations" ADD CONSTRAINT officer_recommendations_comment_min_10
  CHECK (char_length(comment) >= 10);

-- Confidence is a probability.
ALTER TABLE "extracted_fields" ADD CONSTRAINT extracted_fields_confidence_0_1
  CHECK (confidence >= 0 AND confidence <= 1);

-- Optimistic locking counter never goes backwards below zero.
ALTER TABLE "applications" ADD CONSTRAINT applications_version_non_negative CHECK (version >= 0);

-- Only one active rule configuration at a time.
CREATE UNIQUE INDEX rule_config_one_active ON "rule_config" (is_active) WHERE is_active;
