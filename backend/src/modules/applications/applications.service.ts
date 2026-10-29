import type { Application, ApplicationStatus, PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { notFound } from '../../http/errors.js';
import { actorOf, recordAudit, type Db } from '../audit/audit.js';
import { canViewApplication } from './access-policy.js';
import { applicantMessages } from '../../rules/messages.js';
import { loadActiveConfig } from '../workflow/engine-data.js';
import { toApplicantView, toListItem, toStaffView, type TimelineEntry } from './views.js';

const ID_FORMAT = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The single gate every application- or document-scoped route goes through.
 * Unknown id, malformed id and "not yours" all give the same 404, so ids cannot be probed;
 * a denial against a real application is written to the audit log.
 */
export async function authorizeApplication(
  db: Db,
  caller: AuthContext,
  applicationId: string,
): Promise<Application> {
  const app = ID_FORMAT.test(applicationId)
    ? await db.application.findUnique({ where: { application_id: applicationId } })
    : null;
  if (app && canViewApplication(caller, app)) return app;
  await recordAudit(db, {
    type: 'ACCESS_DENIED',
    actor: actorOf(caller),
    applicationId: app?.application_id ?? null,
    details: { reason: app ? 'OBJECT' : 'NOT_FOUND', requested: applicationId.slice(0, 40) },
  });
  throw notFound('Application not found');
}

const RISK_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
// Statuses for which an applicant is told the plain-language reasons of the latest decision.
const SHOW_REASONS = new Set([
  'IN_REVIEW',
  'PENDING_CHECKER',
  'RESUBMISSION_REQUESTED',
  'REJECTED',
  'AUTO_REJECTED',
]);

export function createApplicationsService(prisma: PrismaClient) {
  const listMine = async (caller: AuthContext) =>
    (
      await prisma.application.findMany({
        where: { applicant_user_id: caller.userId },
        orderBy: { created_at: 'desc' },
        take: 100,
      })
    ).map(toListItem);

  /** Status changes of one application, oldest first (who is shown only to staff). */
  async function timelineOf(app: Application, withActor: boolean): Promise<TimelineEntry[]> {
    const events = await prisma.auditEvent.findMany({
      where: { application_id: app.application_id, event_type: 'STATUS_CHANGED' },
      orderBy: { id: 'asc' },
    });
    const steps: TimelineEntry[] = events.map((e) => ({
      status: (e.after as { status?: string } | null)?.status ?? '',
      at: e.created_at.toISOString(),
      ...(withActor ? { actor_role: e.actor_role } : {}),
    }));
    // A case that arrived without a "created" event (imported data) still starts as SUBMITTED.
    const started = (events[0]?.before as { status?: string } | null)?.status;
    if (started) steps.unshift({ status: started, at: app.created_at.toISOString() });
    return steps;
  }

  /**
   * Review work list (FR-6): HIGH risk first, then the case that has waited longest. Risk and decision come from
   * the latest rule evaluation; a case without one is listed last.
   */
  async function queue(status: ApplicationStatus) {
    const apps = await prisma.application.findMany({ where: { status }, take: 500 });
    const ids = apps.map((a) => a.application_id);
    const [evaluations, changes] = await Promise.all([
      prisma.ruleEvaluation.findMany({
        where: { application_id: { in: ids } },
        orderBy: { created_at: 'desc' },
        distinct: ['application_id'],
      }),
      prisma.auditEvent.findMany({
        where: { application_id: { in: ids }, event_type: 'STATUS_CHANGED' },
        orderBy: { id: 'asc' },
      }),
    ]);
    const latest = new Map(evaluations.map((e) => [e.application_id, e]));
    const since = new Map<string, Date>();
    for (const c of changes)
      if ((c.after as { status?: string } | null)?.status === status && c.application_id)
        since.set(c.application_id, c.created_at);

    return apps
      .map((a) => {
        const e = latest.get(a.application_id);
        return {
          ...toListItem(a),
          decision: e?.decision ?? null,
          risk_category: e?.risk_category ?? null,
          reason_codes: e?.reason_codes ?? [],
          waiting_since: (since.get(a.application_id) ?? a.created_at).toISOString(),
        };
      })
      .sort(
        (x, y) =>
          (RISK_ORDER[x.risk_category ?? ''] ?? 9) - (RISK_ORDER[y.risk_category ?? ''] ?? 9) ||
          x.waiting_since.localeCompare(y.waiting_since) ||
          x.application_id.localeCompare(y.application_id),
      )
      .slice(0, 100);
  }

  async function detail(caller: AuthContext, applicationId: string) {
    const app = await authorizeApplication(prisma, caller, applicationId);
    const { config } = await loadActiveConfig(prisma);
    if (caller.role === 'APPLICANT') {
      const [docs, latest, timeline] = await Promise.all([
        prisma.document.findMany({
          where: { application_id: app.application_id },
          orderBy: { doc_id: 'asc' },
        }),
        prisma.ruleEvaluation.findFirst({
          where: { application_id: app.application_id },
          orderBy: { created_at: 'desc' },
        }),
        timelineOf(app, false),
      ]);
      const reasons =
        latest && SHOW_REASONS.has(app.status)
          ? applicantMessages(latest.reason_codes, config)
          : [];
      return toApplicantView(app, docs, { reasons, timeline });
    }
    const [documents, recommendations, checker_actions, evaluation, timeline] = await Promise.all([
      prisma.document.findMany({
        where: { application_id: app.application_id },
        orderBy: { doc_id: 'asc' },
        // the latest extraction of each document: the one the rules used
        include: {
          extractions: {
            orderBy: { created_at: 'desc' },
            take: 1,
            include: { fields: { orderBy: { field_name: 'asc' } } },
          },
        },
      }),
      prisma.officerRecommendation.findMany({
        where: { application_id: app.application_id },
        orderBy: { created_at: 'asc' },
        include: { officer: { select: { display_name: true } } },
      }),
      prisma.checkerDecision.findMany({
        where: { application_id: app.application_id },
        orderBy: { created_at: 'asc' },
        include: { checker: { select: { display_name: true } } },
      }),
      prisma.ruleEvaluation.findFirst({
        where: { application_id: app.application_id },
        orderBy: { created_at: 'desc' },
        include: { screening: true },
      }),
      timelineOf(app, true),
    ]);
    return toStaffView({
      application: app,
      documents,
      recommendations,
      checker_actions,
      evaluation,
      thresholds: { min_field_confidence: config.min_field_confidence },
      timeline,
    });
  }

  return { listMine, queue, detail };
}

export type ApplicationsService = ReturnType<typeof createApplicationsService>;
