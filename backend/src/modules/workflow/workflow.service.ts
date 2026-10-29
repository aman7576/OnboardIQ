import type { ApplicationStatus, PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { conflict, forbidden } from '../../http/errors.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import { authorizeApplication } from '../applications/applications.service.js';
import { openAccount, type BankAccount } from '../internal/core-banking.js';
import { changeStatus } from './change-status.js';
import { loadActiveConfig } from './engine-data.js';
import type { CheckerBody, RecommendationBody } from './workflow.schemas.js';

const AFTER_RECOMMENDATION = {
  APPROVE: 'PENDING_CHECKER',
  REJECT: 'PENDING_CHECKER',
  REQUEST_RESUBMISSION: 'RESUBMISSION_REQUESTED',
} as const satisfies Record<RecommendationBody['recommendation'], ApplicationStatus>;

const AFTER_CHECKER = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  SEND_BACK: 'IN_REVIEW',
} as const satisfies Record<CheckerBody['action'], ApplicationStatus>;

export interface CaseOutcome {
  application_id: string;
  status: ApplicationStatus;
  account?: BankAccount;
}

export function createWorkflowService(prisma: PrismaClient, now: () => Date = () => new Date()) {
  /** KYC Officer (maker): records a recommendation on a case that is IN_REVIEW. */
  async function recommend(
    caller: AuthContext,
    applicationId: string,
    input: RecommendationBody,
  ): Promise<CaseOutcome> {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (app.status !== 'IN_REVIEW')
      throw conflict(
        'INVALID_STATE',
        `Recommendations are recorded on IN_REVIEW cases (this one is ${app.status})`,
      );
    const to = AFTER_RECOMMENDATION[input.recommendation];

    return prisma.$transaction(async (tx) => {
      const recommendation = await tx.officerRecommendation.create({
        data: {
          application_id: app.application_id,
          officer_id: caller.userId,
          recommendation: input.recommendation,
          comment: input.comment,
        },
      });
      await recordAudit(tx, {
        type: 'RECOMMENDATION_RECORDED',
        actor: actorOf(caller),
        applicationId: app.application_id,
        details: { recommendation_id: recommendation.id, recommendation: input.recommendation },
      });
      await changeStatus(tx, app, to, actorOf(caller));
      if (input.recommendation === 'REQUEST_RESUBMISSION') {
        // The applicant has resubmission_sla_days (configuration, 7 by default) to upload new documents.
        const { config } = await loadActiveConfig(tx);
        const deadline = new Date(now().getTime() + config.resubmission_sla_days * 86_400_000);
        await tx.application.update({
          where: { application_id: app.application_id },
          data: { resubmission_deadline: deadline },
        });
      }
      return { application_id: app.application_id, status: to };
    });
  }

  /** Compliance Officer (checker): decides a case that is PENDING_CHECKER. */
  async function decide(
    caller: AuthContext,
    applicationId: string,
    input: CheckerBody,
  ): Promise<CaseOutcome> {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (app.status !== 'PENDING_CHECKER')
      throw conflict(
        'INVALID_STATE',
        `Checker decisions apply to PENDING_CHECKER cases (this one is ${app.status})`,
      );

    // Maker-checker: the person who recommended may not also check (spec FR-7, example 11).
    const recommendation = await prisma.officerRecommendation.findFirst({
      where: { application_id: app.application_id },
      orderBy: { created_at: 'desc' },
    });
    // Makers are everyone who recommended or corrected a field on this case.
    const correctors = await prisma.fieldCorrection.findMany({
      where: { application_id: app.application_id },
      select: { corrected_by: true },
    });
    const makers = new Set([
      ...(recommendation ? [recommendation.officer_id] : []),
      ...correctors.map((c) => c.corrected_by),
    ]);
    if (makers.has(caller.userId)) {
      await recordAudit(prisma, {
        type: 'ACCESS_DENIED',
        actor: actorOf(caller),
        applicationId: app.application_id,
        details: { reason: 'MAKER_CHECKER_SAME_USER' },
      });
      throw forbidden(
        'MAKER_CHECKER_SAME_USER',
        'The officer who recommended or corrected this case cannot also check it',
      );
    }

    const to = AFTER_CHECKER[input.action];
    return prisma.$transaction(async (tx) => {
      await changeStatus(tx, app, to, actorOf(caller));
      const decision = await tx.checkerDecision.create({
        data: {
          application_id: app.application_id,
          checker_id: caller.userId,
          recommendation_id: recommendation?.id ?? null,
          action: input.action,
          comment: input.comment,
        },
      });
      await recordAudit(tx, {
        type: 'CHECKER_DECISION_RECORDED',
        actor: actorOf(caller),
        applicationId: app.application_id,
        details: { decision_id: decision.id, action: input.action },
      });
      // Final approval opens the account through the (mock) core-banking service and starts the re-KYC clock.
      let account: BankAccount | undefined;
      if (input.action === 'APPROVE') {
        account = (await openAccount(tx, app.application_id, actorOf(caller))).account;
        const latest = await tx.ruleEvaluation.findFirst({
          where: { application_id: app.application_id },
          orderBy: { created_at: 'desc' },
        });
        await tx.application.update({
          where: { application_id: app.application_id },
          data: { rekyc_due_date: latest?.rekyc_due_date ?? null },
        });
      }
      return { application_id: app.application_id, status: to, ...(account ? { account } : {}) };
    });
  }

  return { recommend, decide };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
