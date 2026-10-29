import type { EvaluationView } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Matched sanctions / PEP entries. Shown to officers only: the backend does not send this to applicants. */
export function WatchlistPanel({ evaluation }: { evaluation: EvaluationView | null }) {
  const hits = evaluation?.screening ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlist matches</CardTitle>
        <CardDescription>
          Sanctions and PEP screening of the declared name and date of birth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hits.length === 0 ? (
          <p className="text-sm text-ink-soft">No watchlist entry matched.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Watchlist matches">
            {hits.map((h) => (
              <li
                key={`${h.list_type}-${h.entry_id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-3 text-sm"
              >
                <span>
                  <span className="font-mono text-xs text-ink-soft">{h.entry_id}</span>{' '}
                  <span className="font-medium">{h.matched_name}</span>{' '}
                  <span className="text-xs text-ink-soft">
                    ({h.list_type === 'PEP' ? 'PEP list' : 'Sanctions list'})
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular text-xs">similarity {h.similarity.toFixed(4)}</span>
                  <Badge tone={h.result === 'MATCH' ? 'danger' : 'warning'}>
                    {h.result === 'MATCH' ? 'Match' : 'Possible match'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
