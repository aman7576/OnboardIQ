import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  addPep,
  processReceived,
  addSanctions,
  expireOverdue,
  getRekycDue,
  getRuleConfig,
  listPep,
  listSanctions,
  putRuleConfig,
  removePep,
  removeSanctions,
  rescreen,
  type RescreenResult,
  type RuleConfig,
} from '@/api/client';
import { ApiError } from '@/api/http';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Field } from '@/components/common/Field';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { useToast } from '@/components/toast/toast-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAsync } from '@/hooks/useAsync';
import { formatDate, formatDateTime, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

const message = (err: unknown) =>
  err instanceof ApiError
    ? err.fields.length
      ? err.fields.map((f) => `${f.field}: ${f.message}`).join(' ')
      : err.message
    : 'Could not reach the server.';

// Numeric settings that can be edited here; lists and patterns are shown read-only.
const NUMBERS: { key: string; label: string; step: string }[] = [
  { key: 'min_field_confidence', label: 'Minimum usable field confidence', step: '0.01' },
  { key: 'name_match_threshold', label: 'Name match: pass at', step: '0.01' },
  { key: 'name_reject_below', label: 'Name match: reject below', step: '0.01' },
  { key: 'watchlist_match_threshold', label: 'Watchlist: match at', step: '0.01' },
  { key: 'watchlist_possible_threshold', label: 'Watchlist: possible match at', step: '0.01' },
  { key: 'min_age', label: 'Minimum age (years)', step: '1' },
  { key: 'address_proof_max_age_days', label: 'Address proof maximum age (days)', step: '1' },
  { key: 'medium_risk_income', label: 'MEDIUM-risk income threshold (₹)', step: '1' },
  { key: 'resubmission_sla_days', label: 'Resubmission window (days)', step: '1' },
  { key: 'checker_sla_hours', label: 'Checker SLA (hours)', step: '1' },
];

function RuleConfigCard() {
  const toast = useToast();
  const cfg = useAsync(() => getRuleConfig(), []);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [version, setVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (cfg.status === 'loading') return <LoadingState label="Loading the rule configuration" />;
  if (cfg.status === 'error') return <ErrorState error={cfg.error} onRetry={cfg.reload} />;
  const current = cfg.data.config;
  const changed = Object.entries(edits).filter(
    ([k, val]) => val !== '' && Number(val) !== current[k],
  );

  function review(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!changed.length) return setError('Change at least one value.');
    if (!version.trim() || version.trim() === current.version)
      return setError('Give the new configuration a new version name.');
    if (changed.some(([, val]) => Number.isNaN(Number(val))))
      return setError('Every value must be a number.');
    setConfirming(true);
  }

  async function save() {
    setBusy(true);
    try {
      const next: RuleConfig = { ...current, version: version.trim() };
      for (const [k, val] of changed) next[k] = Number(val);
      const saved = await putRuleConfig(next);
      toast.success(
        `Configuration ${saved.version} is now active. Use "Re-screen open cases" to apply it to open cases.`,
      );
      setEdits({});
      setVersion('');
      setConfirming(false);
      cfg.reload();
    } catch (err) {
      setError(message(err));
      setConfirming(false);
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule configuration</CardTitle>
        <CardDescription>
          Active version <strong>{current.version}</strong>, loaded{' '}
          {formatDateTime(cfg.data.loaded_at)}. Saving creates a new version; the old one is kept
          and the change is audited. New evaluations use it at once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={review} noValidate className="grid gap-4" aria-label="Rule configuration">
          <div className="grid gap-3 sm:grid-cols-2">
            {NUMBERS.map((n) => (
              <Field
                key={n.key}
                id={`cfg-${n.key}`}
                label={n.label}
                hint={`Current: ${String(current[n.key])}`}
              >
                <Input
                  type="number"
                  step={n.step}
                  inputMode="decimal"
                  value={edits[n.key] ?? String(current[n.key] ?? '')}
                  onChange={(e) => {
                    setEdits((s) => ({ ...s, [n.key]: e.target.value }));
                    setConfirming(false);
                  }}
                />
              </Field>
            ))}
          </div>
          <dl className="grid gap-1 rounded-md bg-ivory p-3 text-xs">
            {[
              'pan_pattern',
              'pan_holder_type_char',
              'rekyc_years',
              'name_title_tokens',
              'address_proof_types',
            ].map((k) => (
              <div key={k} className="flex flex-wrap gap-2">
                <dt className="font-medium">{humanize(k)}:</dt>
                <dd className="font-mono break-all">{JSON.stringify(current[k])}</dd>
              </div>
            ))}
          </dl>
          <Field
            id="cfg-version"
            label="New version name"
            required
            hint={'For example "1.1". It must differ from the active version.'}
          >
            <Input
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setConfirming(false);
              }}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          {!confirming ? (
            <Button type="submit" className="justify-self-start">
              Review changes
            </Button>
          ) : (
            <div className="grid gap-2 rounded-lg border border-amber/40 bg-amber-soft p-3 text-sm">
              <p>
                Activate version <strong>{version.trim()}</strong> with:{' '}
                {changed
                  .map(([k, val]) => `${humanize(k)} ${String(current[k])} → ${val}`)
                  .join('; ')}
                .
              </p>
              <div className="flex gap-2">
                <Button type="button" loading={busy} onClick={() => void save()}>
                  Activate
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

type ListKind = 'sanctions' | 'pep';
const FORMS: Record<ListKind, { key: string; label: string; required: boolean; hint?: string }[]> =
  {
    sanctions: [
      { key: 'list_id', label: 'List id', required: true, hint: 'For example SAN9001' },
      { key: 'name', label: 'Name', required: true },
      { key: 'alias', label: 'Alias', required: false },
      { key: 'dob', label: 'Date of birth', required: false, hint: 'YYYY-MM-DD, may be empty' },
      { key: 'nationality', label: 'Nationality', required: true },
      { key: 'program', label: 'Programme', required: true },
    ],
    pep: [
      { key: 'pep_id', label: 'PEP id', required: true, hint: 'For example PEP9001' },
      { key: 'name', label: 'Name', required: true },
      { key: 'dob', label: 'Date of birth', required: true, hint: 'YYYY-MM-DD' },
      { key: 'position', label: 'Position', required: true },
      { key: 'category', label: 'Category', required: true, hint: 'DOMESTIC or RCA' },
    ],
  };

interface Row {
  id: string;
  name: string;
  alias?: string;
  dob: string | null;
  extra: string;
}

function WatchlistCard() {
  const toast = useToast();
  const [kind, setKind] = useState<ListKind>('sanctions');
  const list = useAsync(
    async (): Promise<Row[]> =>
      kind === 'sanctions'
        ? (await listSanctions()).entries.map((e) => ({
            id: e.list_id,
            name: e.name,
            alias: e.alias,
            dob: e.dob,
            extra: `${e.nationality} · ${e.program}`,
          }))
        : (await listPep()).entries.map((e) => ({
            id: e.pep_id,
            name: e.name,
            dob: e.dob,
            extra: `${e.position} · ${e.category}`,
          })),
    [kind],
  );
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const missing = FORMS[kind].filter((f) => f.required && !form[f.key]?.trim());
    if (missing.length) return setError(`Fill in: ${missing.map((f) => f.label).join(', ')}.`);
    const body = Object.fromEntries(
      Object.entries(form)
        .filter(([, val]) => val.trim())
        .map(([k, val]) => [k, val.trim()]),
    );
    try {
      if (kind === 'sanctions') await addSanctions(body);
      else await addPep(body);
      toast.success('Entry added. Re-screen open cases to apply it.');
      setForm({});
      list.reload();
    } catch (err) {
      setError(message(err));
    }
  }

  async function remove(id: string) {
    try {
      if (kind === 'sanctions') await removeSanctions(id);
      else await removePep(id);
      toast.success(`${id} removed.`);
      list.reload();
    } catch (err) {
      toast.error(message(err));
    }
    setRemoving(null);
  }

  const columns: Column<Row>[] = [
    {
      id: 'id',
      header: 'Id',
      accessor: (r) => r.id,
      sortable: true,
      cell: (r) => <span className="font-mono text-xs">{r.id}</span>,
    },
    {
      id: 'name',
      header: 'Name',
      accessor: (r) => r.name,
      sortable: true,
      cell: (r) => (
        <span>
          {r.name}
          {r.alias && <span className="block text-xs text-ink-soft">alias {r.alias}</span>}
        </span>
      ),
    },
    {
      id: 'dob',
      header: 'Date of birth',
      accessor: (r) => r.dob,
      sortable: true,
      cell: (r) => formatDate(r.dob),
    },
    {
      id: 'extra',
      header: kind === 'sanctions' ? 'Nationality · programme' : 'Position · category',
      accessor: (r) => r.extra,
    },
    {
      id: 'remove',
      header: '',
      accessor: () => null,
      cell: (r) =>
        removing === r.id ? (
          <span className="flex gap-1">
            <Button size="sm" onClick={() => void remove(r.id)}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            aria-label={`Remove ${r.id}`}
            onClick={() => setRemoving(r.id)}
          >
            Remove
          </Button>
        ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlists</CardTitle>
        <CardDescription>
          Fictional sanctions and PEP lists used for screening. Every change is audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div role="tablist" aria-label="List" className="flex gap-2">
          {(['sanctions', 'pep'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setForm({});
                setError(null);
              }}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                kind === k ? 'border-forest bg-forest-soft font-medium' : 'border-line bg-white',
              )}
            >
              {k === 'sanctions' ? 'Sanctions' : 'PEP'}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => void add(e)}
          noValidate
          aria-label={`Add ${kind} entry`}
          className="grid gap-3 rounded-lg border border-line bg-white p-3 sm:grid-cols-3"
        >
          {FORMS[kind].map((f) => (
            <Field
              key={`${kind}-${f.key}`}
              id={`wl-${kind}-${f.key}`}
              label={f.label}
              required={f.required}
              hint={f.hint}
            >
              <Input
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          {error && (
            <div className="sm:col-span-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          <Button type="submit" className="justify-self-start sm:col-span-3">
            Add entry
          </Button>
        </form>
        {list.status === 'loading' && <LoadingState label="Loading the list" />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'success' && (
          <DataTable
            rows={list.data}
            columns={columns}
            getRowId={(r) => r.id}
            caption={`${kind} list`}
            searchLabel="Search entries"
            searchText={(r) => `${r.id} ${r.name} ${r.alias ?? ''}`}
            pageSizes={[10, 25, 100]}
            emptyTitle="The list is empty"
          />
        )}
      </CardContent>
    </Card>
  );
}

function OperationsCard() {
  const toast = useToast();
  const [result, setResult] = useState<RescreenResult | null>(null);
  const [expired, setExpired] = useState<string[] | null>(null);
  const [processed, setProcessed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [shownDays, setShownDays] = useState(30);
  const due = useAsync(() => getRekycDue(shownDays), [shownDays]);

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } catch (err) {
      toast.error(message(err));
    }
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operations</CardTitle>
        <CardDescription>
          Run on request. Statuses are never changed by re-screening: officers and checkers see new
          hits on the case.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <section className="grid gap-2" aria-label="Received applications">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              loading={busy === 'process'}
              onClick={() =>
                void run('process', async () => {
                  const r = await processReceived();
                  const parts = Object.entries(r.by_status).map(([k, v]) => `${humanize(k)} ${v}`);
                  setProcessed(
                    r.processed
                      ? `${r.processed} processed: ${parts.join(', ')}.`
                      : 'No received applications are waiting.',
                  );
                  toast.success(`${r.processed} application(s) processed.`);
                })
              }
            >
              Process received applications
            </Button>
            <span className="text-sm text-ink-soft">
              Imported applications arrive as Submitted. This runs extraction and the rules for
              each, exactly like a submission. Applications started on screen wait for their
              applicant.
            </span>
          </div>
          {processed && (
            <p className="text-sm" role="status">
              {processed}
            </p>
          )}
        </section>
        <section className="grid gap-2" aria-label="Re-screening">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              loading={busy === 'rescreen'}
              onClick={() =>
                void run('rescreen', async () => {
                  setResult(await rescreen());
                  toast.success('Open cases re-screened.');
                })
              }
            >
              Re-screen open cases
            </Button>
            <span className="text-sm text-ink-soft">
              Re-runs the rules for cases in review, awaiting checker or awaiting documents, with
              the current lists and configuration.
            </span>
          </div>
          {result && (
            <div className="rounded-md border border-line bg-white p-3 text-sm" role="status">
              <p>
                {result.rescreened} case(s) re-screened, {result.changed.length} with a changed
                result{result.failures.length ? `, ${result.failures.length} failed` : ''}.
              </p>
              {result.changed.length > 0 && (
                <ul className="mt-2 grid gap-1">
                  {result.changed.map((c) => (
                    <li key={c.application_id}>
                      <Link
                        className="font-mono text-forest underline"
                        to={`/cases/${c.application_id}`}
                      >
                        {c.application_id}
                      </Link>
                      :{' '}
                      {c.before
                        ? `${c.before.decision} ${c.before.reason_codes.join('|')}`
                        : 'none'}{' '}
                      → <strong>{c.after.decision}</strong> {c.after.reason_codes.join('|')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
        <section className="grid gap-2" aria-label="Overdue resubmissions">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              loading={busy === 'expire'}
              onClick={() =>
                void run('expire', async () => {
                  const r = await expireOverdue();
                  setExpired(r.expired);
                  toast.success(`${r.expired.length} case(s) closed.`);
                })
              }
            >
              Close overdue resubmissions
            </Button>
            <span className="text-sm text-ink-soft">
              Cases waiting for documents past the resubmission window become Closed (final).
            </span>
          </div>
          {expired && (
            <p className="text-sm" role="status">
              {expired.length ? `Closed: ${expired.join(', ')}` : 'No overdue cases.'}
            </p>
          )}
        </section>
        <section className="grid gap-2" aria-label="Re-KYC due">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(days);
              if (Number.isInteger(n) && n >= 0) setShownDays(n);
            }}
          >
            <Field id="rekyc-days" label="Re-KYC due within (days)">
              <Input
                type="number"
                min={0}
                step={1}
                className="w-32"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              Show
            </Button>
          </form>
          {due.status === 'loading' && <LoadingState label="Loading customers due for re-KYC" />}
          {due.status === 'error' && <ErrorState error={due.error} onRetry={due.reload} />}
          {due.status === 'success' &&
            (due.data.customers.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No approved customer is due within {due.data.days} days.
              </p>
            ) : (
              <ul className="grid gap-1 text-sm" aria-label="Customers due for re-KYC">
                {due.data.customers.map((c) => (
                  <li key={c.application_id}>
                    <span className="font-mono">{c.application_id}</span> {c.full_name}: due{' '}
                    {formatDate(c.rekyc_due_date)}
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </CardContent>
    </Card>
  );
}

/** Compliance Officer maintenance: rule configuration, watchlists and on-request jobs. The backend authorises each call. */
export function Maintenance() {
  return (
    <>
      <PageHeader
        eyebrow="Compliance officer"
        title="Maintenance"
        description="Rule configuration, watchlists, re-screening and re-KYC."
      />
      <div className="grid gap-6">
        <OperationsCard />
        <WatchlistCard />
        <RuleConfigCard />
      </div>
    </>
  );
}
