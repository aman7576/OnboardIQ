-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "rekyc_due_date" DATE,
ADD COLUMN     "resubmission_deadline" TIMESTAMPTZ(3),
ADD COLUMN     "submission_round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "submission_round" INTEGER NOT NULL DEFAULT 1;
