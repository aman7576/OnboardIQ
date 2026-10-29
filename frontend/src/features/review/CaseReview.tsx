import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { getStaffApplication, submitCorrections } from '@/api/client';
import { ApiError } from '@/api/http';
import { PageHeader } from '@/components/common/PageHeader';
import { DecisionBadge, RiskBadge, StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, LoadingState } from '@/components/common/States';
import { useToast } from '@/components/toast/toast-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/useAuth';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatInr, humanize } from '@/lib/format';
import { AiSummaryPanel } from './case/AiSummaryPanel';
import { CheckerForm, RecommendationForm } from './case/DecisionForms';
import { DocumentReview, type PendingCorrection } from './case/DocumentReview';
import { correctionKey } from './case/fieldFormats';
import { HistoryPanel } from './case/HistoryPanel';
import { RulesPanel } from './case/RulesPanel';
import { WatchlistPanel } from './case/WatchlistPanel';

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3 py-1.5 text-sm">
    <dt className="text-ink-soft">{label}</dt>
    <dd className="text-right font-medium break-words">{value}</dd>
  </div>
);

/** One case for an officer or a checker. What is offered depends on the role and status; the backend enforces both again. */
export function CaseReview() {
  const { id = '' } = useParams();
  const { state } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const app = useAsync(() => getStaffApplication(id), [id]);
  const [pending, setPending] = useState<Map<string, PendingCorrection>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  if (app.status === 'loading') return <LoadingState label="Loading the case" />;
  if (app.status === 'error') return <ErrorState error={app.error} onRetry={app.reload} />;
  const a = app.data;
  const role = state.status === 'authenticated' ? state.user.role : null;
  const canCorrect = role === 'KYC_OFFICER' && a.status === 'IN_REVIEW';
  const canRecommend = role === 'KYC_OFFICER' && a.status === 'IN_REVIEW';
  const canDecide = role === 'COMPLIANCE_OFFICER' && a.status === 'PENDING_CHECKER';
  const limit = a.thresholds.min_field_confidence;
  const queue = role === 'COMPLIANCE_OFFICER' ? '/checker' : '/review';

  function add(c: PendingCorrection) {
    setPending((m) => new Map(m).set(correctionKey(c), c));
    setConfirming(false);
  }

  async function sendCorrections() {
    setBusy(true);
    setCorrectionError(null);
    try {
      const result = await submitCorrections(a.application_id, [...pending.values()]);
      toast.success(
        `Corrections recorded and the rules re-run (${result.decision.toLowerCase()}). The case is now with the checker.`,
      );
      void navigate(queue);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.fields.length
            ? err.fields.map((f) => f.message).join(' ')
            : err.message
          : 'Could not reach the server.';
      setCorrectionError(message);
      toast.error(message);
      setConfirming(false);
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) app.reload();
    }
  }

  const done = (message: string) => {
    toast.success(message);
    void navigate(queue);
  };

  return (
    <>
      <PageHeader
        eyebrow={role === 'COMPLIANCE_OFFICER' ? 'Checker review' : 'Case review'}
        title={`${a.application_id} · ${a.full_name}`}
        description={`${a.occupation_code ? humanize(a.occupation_code) : ''} · applied ${formatDate(a.application_date)}`}
        actions={
          <>
            <StatusBadge status={a.status} />
            <DecisionBadge decision={a.evaluation?.decision ?? null} />
            <RiskBadge risk={a.evaluation?.risk_category ?? null} />
            <Button variant="ghost" size="sm" asChild>
              <Link to={queue}>Back to queue</Link>
            </Button>
          </>
        }
      />
      {!canCorrect && !canRecommend && !canDecide && (
        <Alert tone="info" className="mb-6">
          This case is {a.status.toLowerCase().replace(/_/g, ' ')}; there is no action for you on it
          right now.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          <section aria-label="Documents" className="grid gap-4">
            <h2 className="font-display text-xl tracking-tight">Documents</h2>
            <p className="-mt-2 text-sm text-ink-soft">
              Values below <strong>{limit.toFixed(2)}</strong> confidence are highlighted: the rules
              do not rely on them.
            </p>
            {a.documents.length === 0 ? (
              <Alert tone="warning">No documents on this case.</Alert>
            ) : (
              a.documents.map((d) => (
                <DocumentReview
                  key={d.doc_id}
                  applicationId={a.application_id}
                  doc={d}
                  limit={limit}
                  canCorrect={canCorrect}
                  pending={pending}
                  onAdd={add}
                />
              ))
            )}
          </section>
          <RulesPanel evaluation={a.evaluation} />
          {a.evaluation?.decision === 'REVIEW' &&
            (a.status === 'IN_REVIEW' || a.status === 'PENDING_CHECKER') && (
              <AiSummaryPanel applicationId={a.application_id} />
            )}
          <WatchlistPanel evaluation={a.evaluation} />
        </div>
        <aside
          aria-label="Case actions"
          className="grid content-start gap-6 lg:sticky lg:top-4 lg:self-start"
        >
          <Card>
            <CardHeader>
              <CardTitle>Declared details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-line">
                <Row label="Name" value={a.full_name} />
                <Row label="Date of birth" value={formatDate(a.dob)} />
                <Row label="PAN" value={a.pan_number} />
                <Row label="Aadhaar" value={a.aadhaar_masked} />
                <Row label="Pincode" value={a.pincode} />
                <Row label="Address" value={a.address} />
                <Row label="Income" value={formatInr(a.annual_income)} />
              </dl>
            </CardContent>
          </Card>

          {canCorrect && (
            <Card>
              <CardHeader>
                <CardTitle>Corrections</CardTitle>
                <CardDescription>
                  Use "Correct" next to a value. Every correction needs a reason.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {pending.size === 0 ? (
                  <p className="text-sm text-ink-soft">No corrections yet.</p>
                ) : (
                  <ul className="grid gap-2" aria-label="Pending corrections">
                    {[...pending.entries()].map(([key, c]) => (
                      <li key={key} className="rounded-md border border-line bg-white p-2 text-xs">
                        <p>
                          <span className="font-mono">{c.doc_id}</span> · {humanize(c.field_name)} →{' '}
                          <span className="font-mono font-medium">{c.new_value}</span>
                        </p>
                        <p className="text-ink-soft">Reason: {c.reason}</p>
                        <button
                          type="button"
                          className="mt-1 text-danger underline"
                          onClick={() =>
                            setPending((m) => {
                              const n = new Map(m);
                              n.delete(key);
                              return n;
                            })
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {correctionError && <Alert tone="danger">{correctionError}</Alert>}
                {pending.size > 0 &&
                  (!confirming ? (
                    <Button onClick={() => setConfirming(true)}>
                      Submit {pending.size} correction{pending.size > 1 ? 's' : ''}
                    </Button>
                  ) : (
                    <div className="grid gap-2 rounded-lg border border-amber/40 bg-amber-soft p-3 text-sm">
                      <p>
                        The rules will re-run on the corrected values and the case will go to the
                        checker.
                      </p>
                      <div className="flex gap-2">
                        <Button loading={busy} onClick={() => void sendCorrections()}>
                          Confirm
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(false)}>
                          Back
                        </Button>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {canRecommend && (
            <Card>
              <CardHeader>
                <CardTitle>Recommend</CardTitle>
              </CardHeader>
              <CardContent>
                <RecommendationForm applicationId={a.application_id} onDone={done} />
              </CardContent>
            </Card>
          )}
          {canDecide && (
            <Card>
              <CardHeader>
                <CardTitle>Decide</CardTitle>
                <CardDescription>Final decision of the checker.</CardDescription>
              </CardHeader>
              <CardContent>
                <CheckerForm applicationId={a.application_id} onDone={done} />
              </CardContent>
            </Card>
          )}
          <HistoryPanel app={a} />
        </aside>
      </div>
    </>
  );
}
