import { useState } from 'react';
import type { EvaluationView, TraceEntry } from '@/api/types';
import { RiskBadge, DecisionBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatScore, humanize } from '@/lib/format';

function Compared({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{humanize(k.replace(/([a-z])([A-Z])/g, '$1_$2'))}</dt>
          <dd className="font-mono break-all">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Rule({ t }: { t: TraceEntry }) {
  return (
    <li className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-ink-soft">{t.rule}</span>
        <span className="text-sm font-medium">{humanize(t.code)}</span>
        <Badge tone={t.outcome === 'REJECT' ? 'danger' : 'warning'}>
          {t.outcome === 'REJECT' ? 'Would reject' : 'Needs review'}
        </Badge>
      </div>
      {t.compared && <Compared value={t.compared} />}
    </li>
  );
}

/** The rules that fired and the values they compared (explainability). Nothing is decided here: it only displays the backend's trace. */
export function RulesPanel({ evaluation }: { evaluation: EvaluationView | null }) {
  const [showOthers, setShowOthers] = useState(false);
  if (!evaluation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rule results</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-soft">The rules have not been run on this case yet.</p>
        </CardContent>
      </Card>
    );
  }
  const fired = evaluation.trace.filter((t) => t.status === 'TRIGGERED');
  const skipped = evaluation.trace.filter((t) => t.status === 'SKIPPED');
  const passed = evaluation.trace.filter((t) => t.status === 'PASSED');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule results</CardTitle>
        <CardDescription>
          Evaluated {new Date(evaluation.triggered_at).toLocaleString('en-IN')}. The rules decide;
          this page shows why.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={evaluation.decision} />
          <RiskBadge risk={evaluation.risk_category} />
          <span className="text-sm text-ink-soft">
            Name match score{' '}
            <span className="tabular font-medium text-ink">
              {formatScore(evaluation.name_match_score)}
            </span>
          </span>
          {evaluation.rekyc_due_date && (
            <span className="text-sm text-ink-soft">
              Re-KYC due{' '}
              <span className="font-medium text-ink">{formatDate(evaluation.rekyc_due_date)}</span>
            </span>
          )}
        </div>
        <section aria-label="Discrepancies">
          <h3 className="mb-2 text-sm font-semibold">Discrepancies ({fired.length})</h3>
          {fired.length === 0 ? (
            <p className="text-sm text-ink-soft">No rule was triggered.</p>
          ) : (
            <ul className="grid gap-2">
              {fired.map((t) => (
                <Rule key={t.rule} t={t} />
              ))}
            </ul>
          )}
        </section>
        {skipped.length > 0 && (
          <section aria-label="Rules not evaluated">
            <h3 className="mb-1 text-sm font-semibold">Not evaluated ({skipped.length})</h3>
            <p className="mb-2 text-xs text-ink-soft">
              A rule is skipped when the value it needs was not read with enough confidence.
            </p>
            <ul className="grid gap-1 text-xs text-ink-soft">
              {skipped.map((t) => (
                <li key={t.rule}>
                  <span className="font-mono">{t.rule}</span> {humanize(t.code)}: {t.skippedBecause}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div>
          <button
            type="button"
            className="text-xs font-medium text-forest underline"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
          >
            {showOthers ? 'Hide' : 'Show'} the {passed.length} rules that passed
          </button>
          {showOthers && (
            <ul className="mt-2 grid gap-1 text-xs text-ink-soft">
              {passed.map((t) => (
                <li key={t.rule}>
                  <span className="font-mono">{t.rule}</span> {humanize(t.code)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
