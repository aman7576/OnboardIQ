import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAiEvaluation } from '@/api/client';
import { ApiError } from '@/api/http';
import type { ClassifierMetrics } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes, formatRatio, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';

const FIELDS = [
  'name',
  'dob',
  'gender',
  'pan_number',
  'aadhaar_last4',
  'address',
  'pincode',
  'document_date',
  'valid_until',
];
const TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
  'OTHER',
];

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="tabular mt-1 font-display text-2xl tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

function Confusion({ m }: { m: ClassifierMetrics }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">
          Confusion matrix: rows are the true type, columns the predicted type
        </caption>
        <thead className="bg-ivory text-ink-soft">
          <tr>
            <th scope="col" className="px-3 py-2">
              True \ predicted
            </th>
            {TYPES.map((t) => (
              <th key={t} scope="col" className="px-3 py-2 text-right">
                {humanize(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {TYPES.map((row) => (
            <tr key={row}>
              <th scope="row" className="px-3 py-2 font-medium">
                {humanize(row)}
              </th>
              {TYPES.map((col) => {
                const n = m.classification.confusion[row]?.[col] ?? 0;
                return (
                  <td
                    key={col}
                    className={cn(
                      'tabular px-3 py-2 text-right',
                      row === col && n > 0 && 'font-semibold text-forest',
                      row !== col && n > 0 && 'font-semibold text-danger',
                    )}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shows the files written by `npm run outputs`. Nothing on this page is computed or typed in by the frontend. */
export function AiEvaluation() {
  const ev = useAsync(() => getAiEvaluation(), []);
  const [tab, setTab] = useState<'report' | 'card'>('report');

  return (
    <>
      <PageHeader
        eyebrow="Compliance officer"
        title="AI evaluation results"
        description="How the extraction provider performed on the supplied sample documents, compared with simpler baselines."
      />
      {ev.status === 'loading' && <LoadingState label="Loading the evaluation" />}
      {ev.status === 'error' &&
        (ev.error instanceof ApiError && ev.error.status === 404 ? (
          <EmptyState
            title="No evaluation has been generated yet"
            hint="Run `npm run outputs` on the server to produce the report, then reload this page."
          />
        ) : (
          <ErrorState error={ev.error} onRetry={ev.reload} />
        ))}
      {ev.status === 'success' &&
        (() => {
          const { metrics: m, files } = ev.data;
          const ai = m.sample.ai.metrics;
          const v1 = m.sample.regexOnly.metrics;
          return (
            <div className="grid gap-6">
              <Alert tone="warning" title="Read these numbers with care">
                The extractor was developed on the sample documents, so these are development-set
                results. The evaluation set has no labels, so no accuracy is claimed for it. No
                result involves an LLM.
              </Alert>
              <section
                aria-label="Headline results"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <Metric
                  label="Classification accuracy"
                  value={formatRatio(ai.classification.overall)}
                  hint={`keyword rule ${formatRatio(m.sample.keywordRule.classification.overall)}`}
                />
                <Metric
                  label="Field exact-match, all documents"
                  value={formatRatio(ai.fields.overall)}
                  hint={`regex-only first version ${formatRatio(v1.fields.overall)}`}
                />
                <Metric
                  label="Field exact-match, poor scans"
                  value={formatRatio(ai.fields.poor)}
                  hint={`regex-only ${formatRatio(v1.fields.poor)}`}
                />
                <Metric
                  label="Precision of fields accepted at ≥ 0.80"
                  value={formatRatio(ai.confidence.accepted)}
                  hint={`coverage ${formatRatio(ai.confidence.coverage)}`}
                />
              </section>
              <Card>
                <CardHeader>
                  <CardTitle>Field accuracy</CardTitle>
                  <CardDescription>
                    Exact match after normalisation, on {m.sample.documents} sample documents.
                    Extractor: <span className="font-mono text-xs">{m.extractorVersion}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Field accuracy by field</caption>
                    <thead className="text-xs text-ink-soft uppercase">
                      <tr>
                        <th scope="col" className="py-2 pr-4">
                          Field
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Regex-only
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          AI provider
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          AI, clean scans
                        </th>
                        <th scope="col" className="py-2">
                          AI, poor scans
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {FIELDS.map((f) => {
                        const z = { correct: 0, total: 0, rate: null };
                        return (
                          <tr key={f}>
                            <th scope="row" className="py-2 pr-4 font-medium">
                              {humanize(f)}
                            </th>
                            <td className="tabular py-2 pr-4">
                              {formatRatio(v1.fields.byField[f] ?? z)}
                            </td>
                            <td className="tabular py-2 pr-4">
                              {formatRatio(ai.fields.byField[f] ?? z)}
                            </td>
                            <td className="tabular py-2 pr-4">
                              {formatRatio(ai.fields.cleanByField[f] ?? z)}
                            </td>
                            <td className="tabular py-2">
                              {formatRatio(ai.fields.poorByField[f] ?? z)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Confusion matrix: AI provider</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Confusion m={ai} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Confusion matrix: keyword rule</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Confusion m={m.sample.keywordRule} />
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Evaluation set (no labels)</CardTitle>
                  <CardDescription>
                    {m.evaluation.applications} applications, {m.evaluation.documents} documents.
                    Agreement with the mock provider is not accuracy.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                  <Metric
                    label="Same decision as with the mock"
                    value={formatRatio(m.evaluation.aiVsMockDecisionAgreement)}
                  />
                  <Metric
                    label="Same document type as the mock"
                    value={formatRatio(m.evaluation.docTypeAgreementWithMock)}
                  />
                  <Metric
                    label="Same value for confident mock fields"
                    value={formatRatio(m.evaluation.fieldAgreementWithMock)}
                  />
                  {m.evaluation.injection && (
                    <p className="text-sm sm:col-span-3">
                      Prompt-injection document{' '}
                      <span className="font-mono">{m.evaluation.injection.docId}</span>: AI provider
                      classified it <strong>{humanize(m.evaluation.injection.aiDocType)}</strong>{' '}
                      (the plain keyword rule said{' '}
                      {humanize(m.evaluation.injection.keywordRuleDocType)}); decision for its
                      application: {humanize(m.evaluation.injection.decisionWithAi)}.
                    </p>
                  )}
                </CardContent>
              </Card>
              <section aria-label="Full report">
                <div role="tablist" aria-label="Document" className="mb-3 flex gap-2">
                  {(['report', 'card'] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      type="button"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm',
                        tab === t
                          ? 'border-forest bg-forest-soft font-medium'
                          : 'border-line bg-white',
                      )}
                    >
                      {t === 'report' ? 'Evaluation report' : 'Model card'}
                    </button>
                  ))}
                </div>
                <article
                  role="tabpanel"
                  className="markdown rounded-lg border border-line bg-white p-5"
                >
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {tab === 'report' ? ev.data.report_markdown : ev.data.model_card_markdown}
                  </Markdown>
                </article>
                <ul className="mt-3 text-xs text-ink-soft" aria-label="Source files">
                  {files.map((f) => (
                    <li key={f.name}>
                      <span className="font-mono">{f.name}</span> · {formatBytes(f.bytes)} · sha256{' '}
                      <span className="font-mono">{f.sha256.slice(0, 16)}…</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          );
        })()}
    </>
  );
}
