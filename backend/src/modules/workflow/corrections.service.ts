// Field correction by a KYC Officer (spec FR-6, section 6.1.2): a mandatory reason, confidence 1.00 and
// source OFFICER, before/after in the audit trail, the rules re-run, and the case goes to the checker.
import type { ExtractionProvider, PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { toDecisionResponse } from '../../rules/response.js';
import { stableUuid } from '../../import/validate.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import { authorizeApplication } from '../applications/applications.service.js';
import { fieldValueProblem, type CorrectionsBody } from './application.schemas.js';
import { changeStatus } from './change-status.js';
import { computeEvaluation, storeEvaluation } from './evaluation.service.js';

export function createCorrectionsService(prisma: PrismaClient, provider: ExtractionProvider) {
  async function correct(caller: AuthContext, applicationId: string, body: CorrectionsBody) {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (app.status !== 'IN_REVIEW')
      throw conflict(
        'INVALID_STATE',
        `Fields can be corrected while a case is IN_REVIEW (this one is ${app.status})`,
      );

    const problems = body.corrections.flatMap((c, i) => {
      const problem = fieldValueProblem(c.field_name, c.new_value);
      return problem ? [{ field: `corrections[${i}].new_value`, message: problem }] : [];
    });
    if (problems.length) throw badRequest('Validation failed', problems);

    return prisma.$transaction(async (tx) => {
      const actor = actorOf(caller);
      for (const item of body.corrections) {
        const doc = await tx.document.findFirst({
          where: { doc_id: item.doc_id, application_id: app.application_id },
        });
        if (!doc) throw notFound('Document not found');
        const extraction = await tx.extraction.findFirst({
          where: { doc_id: doc.doc_id },
          orderBy: { created_at: 'desc' },
        });
        if (!extraction)
          throw conflict('NOT_EXTRACTED', `Document ${doc.doc_id} has not been extracted yet`);

        const field = await tx.extractedField.findUnique({
          where: {
            extraction_id_field_name: { extraction_id: extraction.id, field_name: item.field_name },
          },
        });
        const correction = await tx.fieldCorrection.create({
          data: {
            application_id: app.application_id,
            doc_id: doc.doc_id,
            field_name: item.field_name,
            old_value: field?.value ?? null,
            old_confidence: field?.confidence ?? null,
            new_value: item.new_value,
            reason: item.reason,
            corrected_by: caller.userId,
          },
        });
        if (field) {
          await tx.extractedField.update({
            where: { id: field.id },
            data: { value: item.new_value, confidence: 1, source: 'OFFICER' },
          });
        } else {
          await tx.extractedField.create({
            data: {
              id: stableUuid(extraction.id, item.field_name, 'officer'),
              extraction_id: extraction.id,
              doc_id: doc.doc_id,
              field_name: item.field_name,
              value: item.new_value,
              confidence: 1,
              source: 'OFFICER',
            },
          });
        }
        await recordAudit(tx, {
          type: 'FIELD_CORRECTED',
          actor,
          applicationId: app.application_id,
          docId: doc.doc_id,
          before: {
            field: item.field_name,
            value: field?.value ?? null,
            confidence: field ? Number(field.confidence) : null,
            source: field?.source ?? null,
          },
          after: {
            field: item.field_name,
            value: item.new_value,
            confidence: 1,
            source: 'OFFICER',
          },
          details: { reason: item.reason, correction_id: correction.id },
        });
      }

      // Re-run the rules on the corrected data, then send the reviewed case to the checker.
      const computed = await computeEvaluation(tx, app);
      await storeEvaluation(tx, app, computed, 'FIELD_CORRECTION', actor, provider);
      await changeStatus(tx, app, 'PENDING_CHECKER', actor, { event: 'FIELDS_CORRECTED' });
      return toDecisionResponse(
        app.application_id,
        computed.evaluation,
        computed.documents,
        'PENDING_CHECKER',
      );
    });
  }

  return { correct };
}

export type CorrectionsService = ReturnType<typeof createCorrectionsService>;
