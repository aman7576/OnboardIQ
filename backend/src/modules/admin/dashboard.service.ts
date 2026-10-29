// Compliance dashboard (spec FR-10). Every figure is computed from the database for the selected date range; the
// response also states how each figure is defined, because the spec leaves some definitions open.
import type { ApplicationStatus, PrismaClient } from '@prisma/client';
import { loadActiveConfig } from '../workflow/engine-data.js';

const STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'EXTRACTING',
  'AUTO_APPROVED',
  'IN_REVIEW',
  'RESUBMISSION_REQUESTED',
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'AUTO_REJECTED',
  'CLOSED_EXPIRED',
];
const rate = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export interface DashboardRange {
  from?: string;
  to?: string;
}

export function createDashboardService(prisma: PrismaClient, now: () => Date) {
  async function summary(range: DashboardRange) {
    // The date filter applies to application_date (the date the customer applied).
    const apps = await prisma.application.findMany({
      where: {
        ...(range.from || range.to
          ? {
              application_date: {
                ...(range.from ? { gte: new Date(range.from) } : {}),
                ...(range.to ? { lte: new Date(range.to) } : {}),
              },
            }
          : {}),
      },
      select: { application_id: true, status: true },
    });
    const ids = apps.map((a) => a.application_id);
    const byStatus = Object.fromEntries(
      STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length]),
    ) as Record<ApplicationStatus, number>;

    // "Decided" = went through the rules engine at least once. The first decision of each application is used
    // so that re-screening and resubmission do not count one application twice.
    const evaluations = await prisma.ruleEvaluation.findMany({
      where: { application_id: { in: ids } },
      orderBy: { created_at: 'asc' },
    });
    const first = new Map<string, (typeof evaluations)[number]>();
    for (const e of evaluations) if (!first.has(e.application_id)) first.set(e.application_id, e);
    const firsts = [...first.values()];
    const count = (d: string) => firsts.filter((e) => e.decision === d).length;
    const decided = {
      count: firsts.length,
      approve: count('APPROVE'),
      review: count('REVIEW'),
      reject: count('REJECT'),
    };

    const codes = new Map<string, number>();
    for (const e of firsts) for (const c of e.reason_codes) codes.set(c, (codes.get(c) ?? 0) + 1);
    const topReasonCodes = [...codes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([code, n]) => ({ code, count: n }));

    // Time in review and waiting time at the checker come from the status-change audit trail.
    const events = await prisma.auditEvent.findMany({
      where: { application_id: { in: ids }, event_type: 'STATUS_CHANGED' },
      orderBy: { id: 'asc' },
    });
    const byApp = new Map<string, typeof events>();
    for (const e of events)
      if (e.application_id)
        byApp.set(e.application_id, [...(byApp.get(e.application_id) ?? []), e]);
    const durations: number[] = [];
    let openReviews = 0;
    const waitingSince = new Map<string, Date>();
    for (const [id, list] of byApp) {
      let enteredReview: Date | null = null;
      for (const e of list) {
        const before = (e.before as { status?: string } | null)?.status;
        const after = (e.after as { status?: string } | null)?.status;
        if (after === 'IN_REVIEW') enteredReview = e.created_at;
        else if (before === 'IN_REVIEW' && enteredReview) {
          durations.push((e.created_at.getTime() - enteredReview.getTime()) / 1000);
          enteredReview = null;
        }
        if (after === 'PENDING_CHECKER') waitingSince.set(id, e.created_at);
      }
      if (enteredReview) openReviews++;
    }

    const { config } = await loadActiveConfig(prisma);
    const pending = apps.filter((a) => a.status === 'PENDING_CHECKER');
    const limit = config.checker_sla_hours * 3_600_000;
    const overdue = pending.filter((a) => {
      const since = waitingSince.get(a.application_id);
      return since !== undefined && now().getTime() - since.getTime() > limit;
    }).length;

    return {
      range: { from: range.from ?? null, to: range.to ?? null },
      total_applications: apps.length,
      by_status: byStatus,
      decided,
      rates: {
        straight_through: rate(byStatus.AUTO_APPROVED, decided.count),
        review: rate(decided.review, decided.count),
        reject: rate(decided.reject, decided.count),
      },
      top_reason_codes: topReasonCodes,
      review_time: {
        average_seconds: durations.length
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : null,
        completed_reviews: durations.length,
        open_reviews: openReviews,
      },
      pending_checker: { count: pending.length, overdue, sla_hours: config.checker_sla_hours },
      definitions: {
        date_filter: 'application_date of the application',
        decided:
          'applications that have been through the rules engine at least once; the first decision of each is used',
        straight_through_rate: 'applications now AUTO_APPROVED divided by decided applications',
        review_rate: 'share of decided applications whose first decision was REVIEW',
        reject_rate: 'share of decided applications whose first decision was REJECT',
        top_reason_codes: 'reason codes of the first decision of each decided application',
        average_time_in_review:
          'mean time between entering IN_REVIEW and leaving it, over reviews that have ended',
        pending_checker_overdue: 'cases waiting at the checker for longer than checker_sla_hours',
      },
    };
  }
  return { summary };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
