import { useState } from 'react';
import { getAiSummary, type AiSummary } from '@/api/client';
import { ApiError } from '@/api/http';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';

const explain = (err: unknown): string => {
  if (err instanceof ApiError && err.status === 503)
    return err.message.includes('configured')
      ? 'AI summaries are not enabled on this server.'
      : 'The AI service did not answer. Try again later.';
  if (err instanceof ApiError && err.status === 502)
    return 'The AI summary was withheld because it failed a safety check (decision wording, too long, or a value not in the case).';
  if (err instanceof ApiError) return err.message;
  return 'Could not reach the server.';
};

/** AI-5: optional discrepancy summary for a REVIEW case. Generated only on request; it never recommends a decision. */
export function AiSummaryPanel({ applicationId }: { applicationId: string }) {
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setSummary(await getAiSummary(applicationId));
    } catch (err) {
      setError(explain(err));
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discrepancy summary</CardTitle>
        <CardDescription>
          Written by an LLM from the rule results and extracted values only. It is not a
          recommendation; check the values above.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {summary ? (
          <figure className="grid gap-2" aria-label="AI-generated summary">
            <Badge tone="info" className="justify-self-start">
              AI-generated
            </Badge>
            <blockquote className="text-sm leading-relaxed">{summary.summary}</blockquote>
            <figcaption className="text-xs text-ink-soft">
              {summary.words} words · {summary.model} · {summary.prompt_version} ·{' '}
              {formatDateTime(summary.generated_at)}
            </figcaption>
          </figure>
        ) : (
          <Button
            variant="outline"
            className="justify-self-start"
            loading={busy}
            onClick={() => void load()}
          >
            Generate AI summary
          </Button>
        )}
        {error && (
          <p role="status" className="text-sm text-ink-soft">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
