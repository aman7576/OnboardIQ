import { useState, type FormEvent, type ReactNode } from 'react';
import { getDashboard } from '@/api/client';
import { Link } from 'react-router';
import { STATUSES } from '@/api/types';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SystemStatus } from '@/features/system-status/SystemStatus';
import { useAsync } from '@/hooks/useAsync';
import { formatDuration, formatPercent, humanize } from '@/lib/format';

function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4" data-testid={testId}>
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="tabular mt-1 font-display text-3xl tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

/** Every number comes from the backend for the chosen dates; the screen computes nothing of its own. */
export function ComplianceDashboard() {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [draft, setDraft] = useState(range);
  const dash = useAsync(
    () =>
      getDashboard({
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
      }),
    [range.from, range.to],
  );

  function apply(e: FormEvent) {
    e.preventDefault();
    setRange(draft);
  }

  return (
    <>
      <PageHeader
        eyebrow="Compliance officer"
        title="Dashboard"
        description="Applications, decisions and work waiting for a checker."
      />
      <form
        onSubmit={apply}
        className="mb-6 flex flex-wrap items-end gap-3"
        aria-label="Date filter"
      >
        <div className="grid gap-1">
          <label htmlFor="from" className="text-xs font-medium text-ink-soft">
            Applied from
          </label>
          <Input
            id="from"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-xs font-medium text-ink-soft">
            Applied until
          </label>
          <Input
            id="to"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </div>
        <Button type="submit">Apply</Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft({ from: '', to: '' });
            setRange({ from: '', to: '' });
          }}
        >
          Clear
        </Button>
      </form>

      {dash.status === 'loading' && <LoadingState label="Loading the dashboard" />}
      {dash.status === 'error' && <ErrorState error={dash.error} onRetry={dash.reload} />}
      {dash.status === 'success' &&
        (() => {
          const d = dash.data;
          if (d.total_applications === 0)
            return (
              <EmptyState
                title="No applications in this period"
                hint="Choose a different date range, or clear the filter."
              />
            );
          const maxStatus = Math.max(1, ...Object.values(d.by_status));
          const maxCode = Math.max(1, ...d.top_reason_codes.map((c) => c.count));
          return (
            <div className="grid gap-6">
              {d.by_status.SUBMITTED > 0 && (
                <Alert
                  tone="info"
                  title={`${d.by_status.SUBMITTED} application(s) received but not processed yet`}
                >
                  They count in Applications but not in the rates. Imported applications are
                  processed on the{' '}
                  <Link to="/maintenance" className="font-medium underline">
                    Maintenance
                  </Link>{' '}
                  page (or with <code>npm run db:process</code>); applications started on screen
                  wait for their applicant to submit.
                </Alert>
              )}
              <section
                aria-label="Key figures"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <Stat
                  testId="stat-total"
                  label="Applications"
                  value={d.total_applications}
                  hint={`${d.decided.count} decided by the rules`}
                />
                <Stat
                  testId="stat-stp"
                  label="Straight-through rate"
                  value={formatPercent(d.rates.straight_through)}
                  hint="Approved automatically ÷ decided"
                />
                <Stat
                  testId="stat-review"
                  label="Review rate"
                  value={formatPercent(d.rates.review)}
                  hint={`${d.decided.review} of ${d.decided.count} decided`}
                />
                <Stat
                  testId="stat-reject"
                  label="Reject rate"
                  value={formatPercent(d.rates.reject)}
                  hint={`${d.decided.reject} of ${d.decided.count} decided`}
                />
                <Stat
                  testId="stat-pending"
                  label="Waiting for a checker"
                  value={d.pending_checker.count}
                  hint={`${d.pending_checker.overdue} older than ${d.pending_checker.sla_hours} h`}
                />
                <Stat
                  testId="stat-review-time"
                  label="Average time in review"
                  value={formatDuration(d.review_time.average_seconds)}
                  hint={`${d.review_time.completed_reviews} finished, ${d.review_time.open_reviews} still open`}
                />
              </section>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Applications by status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid gap-2" aria-label="Applications by status">
                      {STATUSES.map((s) => (
                        <li
                          key={s}
                          className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm"
                        >
                          <StatusBadge status={s} />
                          <div
                            className="h-2 overflow-hidden rounded-full bg-ivory-deep"
                            aria-hidden
                          >
                            <div
                              className="h-full rounded-full bg-forest"
                              style={{ width: `${(d.by_status[s] / maxStatus) * 100}%` }}
                            />
                          </div>
                          <span
                            className="tabular text-right font-medium"
                            data-testid={`status-${s}`}
                          >
                            {d.by_status[s]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Top reason codes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {d.top_reason_codes.length === 0 ? (
                      <p className="text-sm text-ink-soft">No reason codes in this period.</p>
                    ) : (
                      <ol className="grid gap-2" aria-label="Top reason codes">
                        {d.top_reason_codes.map((c) => (
                          <li
                            key={c.code}
                            className="grid grid-cols-[1fr_6rem_2rem] items-center gap-3 text-sm"
                          >
                            <span title={c.code}>{humanize(c.code)}</span>
                            <div
                              className="h-2 overflow-hidden rounded-full bg-ivory-deep"
                              aria-hidden
                            >
                              <div
                                className="h-full rounded-full bg-amber"
                                style={{ width: `${(c.count / maxCode) * 100}%` }}
                              />
                            </div>
                            <span className="tabular text-right font-medium">{c.count}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              </div>
              <details className="rounded-lg border border-line bg-white p-4 text-sm">
                <summary className="cursor-pointer font-medium">
                  How these figures are calculated
                </summary>
                <dl className="mt-3 grid gap-2">
                  {Object.entries(d.definitions).map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-medium">{humanize(k)}</dt>
                      <dd className="text-ink-soft">{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          );
        })()}
      <div className="mt-8 max-w-xl">
        <SystemStatus />
      </div>
    </>
  );
}
