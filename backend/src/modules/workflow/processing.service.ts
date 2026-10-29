// The case processor: submission -> extraction -> rules -> routing, plus resubmission and expiry.
// Every status change goes through changeStatus (version check + audit), so two conflicting actions
// on the same case cannot both succeed (the loser gets 409).
import { randomInt } from 'node:crypto';
import type { Application, ExtractionProvider, PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { conflict, HttpError, unprocessable } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { routeStatus } from '../../rules/routing.js';
import { actorOf, recordAudit, SYSTEM, type Actor } from '../audit/audit.js';
import { authorizeApplication } from '../applications/applications.service.js';
import type { ExtractionService } from '../extraction/extraction.service.js';
import { openAccount } from '../internal/core-banking.js';
import { applicationBody } from './application.schemas.js';
import { changeStatus } from './change-status.js';
import { loadActiveConfig } from './engine-data.js';
import { computeEvaluation, storeEvaluation } from './evaluation.service.js';

export interface ProcessingDeps {
  prisma: PrismaClient;
  extraction: ExtractionService;
  provider: ExtractionProvider;
  now: () => Date;
}

/** Calendar date in India Standard Time (NFR: dates are handled as calendar dates in IST). */
export const todayIst = (now: Date): string =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function createProcessingService({ prisma, extraction, provider, now }: ProcessingDeps) {
  /** Form submission (FR-2): validates, stores the application as SUBMITTED. Documents come next. */
  async function createApplication(
    caller: AuthContext,
    body: unknown,
  ): Promise<{ application_id: string; status: 'SUBMITTED' }> {
    const { config } = await loadActiveConfig(prisma);
    const input = parse(applicationBody(config.pan_pattern, todayIst(now())), body);
    if (!(input.occupation_code in config.occupations))
      throw new HttpError(400, 'VALIDATION_ERROR', 'Validation failed', [
        { field: 'occupation_code', message: 'is not a known occupation code' },
      ]);

    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `A4${randomInt(100000, 999999)}`;
      if (await prisma.application.findUnique({ where: { application_id: id } })) continue;
      await prisma.$transaction(async (tx) => {
        await tx.application.create({
          data: {
            application_id: id,
            dataset: 'LIVE',
            application_date: new Date(todayIst(now())),
            full_name: input.full_name,
            dob: new Date(input.dob),
            gender: input.gender,
            pan_number: input.pan_number,
            aadhaar_last4: input.aadhaar_last4,
            mobile: input.mobile,
            email: input.email,
            address: input.address,
            city: input.city,
            state: input.state,
            pincode: input.pincode,
            occupation_code: input.occupation_code,
            annual_income: input.annual_income,
            kyc_consent: true,
            applicant_user_id: caller.userId,
          },
        });
        await recordAudit(tx, {
          type: 'STATUS_CHANGED',
          actor: actorOf(caller),
          applicationId: id,
          before: {},
          after: { status: 'SUBMITTED' },
          details: { event: 'APPLICATION_CREATED' },
        });
      });
      return { application_id: id, status: 'SUBMITTED' };
    }
    throw new Error('could not allocate an application id');
  }

  /** Extraction + rules + routing for a case that is SUBMITTED. */
  async function process(
    caller: AuthContext | null,
    applicationId: string,
    trigger: 'SUBMISSION' | 'RESUBMISSION',
  ): Promise<Application> {
    const actor: Actor = caller ? actorOf(caller) : SYSTEM;

    // 1. SUBMITTED -> EXTRACTING (committed first, so a concurrent second submit loses with 409).
    await prisma.$transaction(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({
        where: { application_id: applicationId },
      });
      if (app.status !== 'SUBMITTED')
        throw conflict(
          'INVALID_STATE',
          `Only a SUBMITTED case can be processed (this one is ${app.status})`,
        );
      await changeStatus(tx, app, 'EXTRACTING', actor);
    });

    // 2. Extraction: the provider proposes doc_type and fields with confidence; it never decides.
    for (const doc of await prisma.document.findMany({ where: { application_id: applicationId } }))
      await extraction.extractDocument(doc, caller);

    // 3. Rules decide and the case is routed, in one transaction.
    return prisma.$transaction(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({
        where: { application_id: applicationId },
      });
      if (app.status !== 'EXTRACTING')
        throw conflict(
          'INVALID_STATE',
          `The case moved to ${app.status} while it was being processed`,
        );

      let computed;
      try {
        computed = await computeEvaluation(tx, app);
      } catch (err) {
        // Fail safe: if the engine cannot evaluate (for example data it does not know), a person looks at the case.
        await changeStatus(tx, app, 'IN_REVIEW', actor, {
          reason: 'EVALUATION_FAILED',
          message: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
        return tx.application.findUniqueOrThrow({ where: { application_id: applicationId } });
      }
      const row = await storeEvaluation(tx, app, computed, trigger, actor, provider);
      const to = routeStatus(computed.evaluation.decision, computed.evaluation.riskCategory);
      await changeStatus(tx, app, to, actor);
      if (to === 'AUTO_APPROVED') {
        await openAccount(tx, applicationId, SYSTEM); // permitted by the rules: final, the account opens
        await tx.application.update({
          where: { application_id: applicationId },
          data: { rekyc_due_date: row.rekyc_due_date },
        });
      }
      return tx.application.findUniqueOrThrow({ where: { application_id: applicationId } });
    });
  }

  /** Applicant submits a prepared application (documents already uploaded). */
  async function submit(caller: AuthContext, applicationId: string): Promise<Application> {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (app.status !== 'SUBMITTED')
      throw conflict(
        'INVALID_STATE',
        `Only a SUBMITTED case can be submitted for processing (this one is ${app.status})`,
      );
    if (app.kyc_consent === false)
      throw unprocessable('CONSENT_REQUIRED', 'Consent to KYC checks is mandatory');
    if ((await prisma.document.count({ where: { application_id: applicationId } })) === 0)
      throw unprocessable('NO_DOCUMENTS', 'Upload documents before submitting');
    return process(caller, applicationId, 'SUBMISSION');
  }

  /**
   * Processes received applications from the supplied data pack. The importer stores them as SUBMITTED (application
   * and documents received, spec 6.1.1); this runs extraction, the rules and routing for each, exactly as a
   * submission does. Applications created on screen (dataset LIVE) are left alone: their applicant submits them.
   * Safe to repeat: only cases still SUBMITTED are touched; one that another action moved first is skipped.
   */
  async function processReceived(caller: AuthContext | null, limit = 1000) {
    const received = await prisma.application.findMany({
      where: {
        status: 'SUBMITTED',
        dataset: { in: ['SAMPLE', 'EVAL'] },
        OR: [{ kyc_consent: null }, { kyc_consent: true }], // NOT (= false) would also drop NULL in SQL
        documents: { some: {} },
      },
      orderBy: { application_id: 'asc' },
      select: { application_id: true },
      take: limit,
    });
    const byStatus: Record<string, number> = {};
    const skipped: string[] = [];
    for (const { application_id } of received) {
      try {
        const app = await process(caller, application_id, 'SUBMISSION');
        byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 409)) throw err;
        skipped.push(application_id);
      }
    }
    return { processed: received.length - skipped.length, by_status: byStatus, skipped };
  }

  /** Moves overdue resubmission requests to CLOSED_EXPIRED (final). Safe to call repeatedly. */
  async function expireOverdue(actor: Actor = SYSTEM): Promise<string[]> {
    const overdue = await prisma.application.findMany({
      where: { status: 'RESUBMISSION_REQUESTED', resubmission_deadline: { lt: now() } },
    });
    const expired: string[] = [];
    for (const app of overdue) {
      try {
        await prisma.$transaction((tx) =>
          changeStatus(tx, app, 'CLOSED_EXPIRED', actor, {
            reason: 'RESUBMISSION_WINDOW_ELAPSED',
            deadline: app.resubmission_deadline?.toISOString() ?? null,
          }),
        );
        expired.push(app.application_id);
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 409)) throw err; // someone acted on it first: leave it
      }
    }
    return expired;
  }

  /** Applicant re-uploaded documents after a resubmission request: evaluate the case again (FR-8). */
  async function resubmit(caller: AuthContext, applicationId: string): Promise<Application> {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (app.status !== 'RESUBMISSION_REQUESTED')
      throw conflict(
        'INVALID_STATE',
        `Resubmission applies to RESUBMISSION_REQUESTED cases (this one is ${app.status})`,
      );
    if (app.resubmission_deadline && app.resubmission_deadline < now()) {
      await expireOverdue();
      throw conflict(
        'RESUBMISSION_EXPIRED',
        'The resubmission window has closed; the case is closed',
      );
    }
    const fresh = await prisma.document.count({
      where: { application_id: applicationId, submission_round: app.submission_round + 1 },
    });
    if (fresh === 0)
      throw unprocessable('NO_NEW_DOCUMENTS', 'Upload the requested documents before resubmitting');

    await prisma.$transaction(async (tx) => {
      const current = await tx.application.findUniqueOrThrow({
        where: { application_id: applicationId },
      });
      await changeStatus(tx, current, 'SUBMITTED', actorOf(caller), {
        event: 'RESUBMITTED',
        submission_round: current.submission_round + 1,
      });
      await tx.application.update({
        where: { application_id: applicationId },
        data: { submission_round: { increment: 1 }, resubmission_deadline: null },
      });
    });
    return process(caller, applicationId, 'RESUBMISSION');
  }

  return { createApplication, submit, resubmit, expireOverdue, processReceived };
}

export type ProcessingService = ReturnType<typeof createProcessingService>;
