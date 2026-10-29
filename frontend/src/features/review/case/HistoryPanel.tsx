import type { StaffApplication } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, humanize } from '@/lib/format';
import { STATUS_META } from '@/lib/status';

export function HistoryPanel({ app }: { app: StaffApplication }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <ol className="grid gap-2" aria-label="Status history">
          {app.timeline.map((s, i) => (
            <li key={`${s.status}-${i}`} className="flex justify-between gap-3">
              <span>
                {STATUS_META[s.status].label}
                {s.actor_role ? (
                  <span className="text-xs text-ink-soft"> · {humanize(s.actor_role)}</span>
                ) : null}
              </span>
              <span className="text-xs text-ink-soft">{formatDateTime(s.at)}</span>
            </li>
          ))}
        </ol>
        {app.recommendations.length > 0 && (
          <section aria-label="Recommendations">
            <h3 className="mb-1 font-semibold">Recommendations</h3>
            <ul className="grid gap-2">
              {app.recommendations.map((r) => (
                <li key={r.id} className="rounded-md border border-line bg-white p-2">
                  <p className="font-medium">
                    {humanize(r.recommendation)}{' '}
                    <span className="text-xs font-normal text-ink-soft">
                      by {r.officer}, {formatDateTime(r.created_at)}
                    </span>
                  </p>
                  <p className="text-ink-soft">{r.comment}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {app.checker_decisions.length > 0 && (
          <section aria-label="Checker decisions">
            <h3 className="mb-1 font-semibold">Checker decisions</h3>
            <ul className="grid gap-2">
              {app.checker_decisions.map((c) => (
                <li key={c.id} className="rounded-md border border-line bg-white p-2">
                  <p className="font-medium">
                    {humanize(c.action)}{' '}
                    <span className="text-xs font-normal text-ink-soft">
                      by {c.checker}, {formatDateTime(c.created_at)}
                    </span>
                  </p>
                  <p className="text-ink-soft">{c.comment}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
