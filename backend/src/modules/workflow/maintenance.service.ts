// Compliance maintenance: re-screen open cases after a watchlist or configuration change, and list
// customers whose re-KYC falls due.
import type { ApplicationStatus, ExtractionProvider, PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { actorOf } from '../audit/audit.js';
import { computeEvaluation, storeEvaluation } from './evaluation.service.js';

// "Open" cases: not final. (ASSUMPTION: cases still being extracted are not re-screened; they are evaluated fresh.)
const OPEN: ApplicationStatus[] = ['IN_REVIEW', 'PENDING_CHECKER', 'RESUBMISSION_REQUESTED'];

export interface RescreenChange {
  application_id: string;
  status: ApplicationStatus;
  before: { decision: string; reason_codes: string[] } | null;
  after: { decision: string; reason_codes: string[] };
}

export function createMaintenanceService(
  prisma: PrismaClient,
  provider: ExtractionProvider,
  now: () => Date,
) {
  /**
   * Re-runs the rules for every open case against the current lists (trigger RESCREEN). The status is not
   * changed: a new sanctions hit is shown to the officer or checker on the case, who decide what to do.
   */
  async function rescreenOpenCases(caller: AuthContext) {
    const open = await prisma.application.findMany({
      where: { status: { in: OPEN } },
      orderBy: { application_id: 'asc' },
    });
    const changes: RescreenChange[] = [];
    const failures: { application_id: string; reason: string }[] = [];
    for (const app of open) {
      try {
        await prisma.$transaction(async (tx) => {
          const before = await tx.ruleEvaluation.findFirst({
            where: { application_id: app.application_id },
            orderBy: { created_at: 'desc' },
          });
          const computed = await computeEvaluation(tx, app);
          await storeEvaluation(tx, app, computed, 'RESCREEN', actorOf(caller), provider);
          const after = {
            decision: computed.evaluation.decision,
            reason_codes: computed.evaluation.reasonCodes,
          };
          const same =
            before &&
            before.decision === after.decision &&
            before.reason_codes.join('|') === after.reason_codes.join('|');
          if (!same)
            changes.push({
              application_id: app.application_id,
              status: app.status,
              before: before
                ? { decision: before.decision, reason_codes: before.reason_codes }
                : null,
              after,
            });
        });
      } catch (err) {
        failures.push({
          application_id: app.application_id,
          reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
        });
      }
    }
    return { rescreened: open.length - failures.length, changed: changes, failures };
  }

  /** Approved customers whose re-KYC is due within `days` (including overdue), soonest first. */
  async function rekycDue(days: number) {
    const horizon = new Date(now().getTime() + days * 86_400_000);
    const apps = await prisma.application.findMany({
      where: {
        status: { in: ['AUTO_APPROVED', 'APPROVED'] },
        rekyc_due_date: { not: null, lte: horizon },
      },
      orderBy: { rekyc_due_date: 'asc' },
      take: 500,
    });
    return apps.map((a) => ({
      application_id: a.application_id,
      full_name: a.full_name,
      status: a.status,
      rekyc_due_date: a.rekyc_due_date?.toISOString().slice(0, 10) ?? null,
    }));
  }

  return { rescreenOpenCases, rekycDue };
}

export type MaintenanceService = ReturnType<typeof createMaintenanceService>;
