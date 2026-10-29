import { Link, useParams } from 'react-router';
import { getApplicantApplication } from '@/api/client';
import type { TimelineEntry } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, LoadingState } from '@/components/common/States';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes, formatDate, formatDateTime, formatInr, humanize } from '@/lib/format';
import { STATUS_META } from '@/lib/status';

function Timeline({ steps }: { steps: TimelineEntry[] }) {
  return (
    <ol className="grid gap-4" aria-label="Status timeline">
      {steps.map((s, i) => (
        <li key={`${s.status}-${s.at}-${i}`} className="flex gap-3">
          <span
            aria-hidden
            className={`mt-1.5 size-2.5 shrink-0 rounded-full ${i === steps.length - 1 ? 'bg-forest' : 'bg-line'}`}
          />
          <div>
            <p className="text-sm font-medium">{STATUS_META[s.status].label}</p>
            <p className="text-xs text-ink-soft">{formatDateTime(s.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <dt className="text-ink-soft">{label}</dt>
    <dd className="text-right font-medium">{value}</dd>
  </div>
);

export function ApplicationDetails() {
  const { id = '' } = useParams();
  const app = useAsync(() => getApplicantApplication(id), [id]);

  if (app.status === 'loading') return <LoadingState label="Loading the application" />;
  if (app.status === 'error') return <ErrorState error={app.error} onRetry={app.reload} />;
  const a = app.data;
  const meta = STATUS_META[a.status];

  return (
    <>
      <PageHeader
        eyebrow="Application"
        title={a.application_id}
        description={`${a.full_name} · applied on ${formatDate(a.application_date)}`}
        actions={<StatusBadge status={a.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Where things stand</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm">{meta.hint}.</p>
              {a.reasons.length > 0 && (
                <Alert
                  tone={
                    a.status === 'REJECTED' || a.status === 'AUTO_REJECTED' ? 'danger' : 'warning'
                  }
                  title="Why"
                >
                  <ul className="list-disc pl-5">
                    {a.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {a.status === 'RESUBMISSION_REQUESTED' && (
                <Alert tone="warning" title="Please upload new documents">
                  {a.resubmission_deadline
                    ? `You have until ${formatDateTime(a.resubmission_deadline)}. After that this application is closed.`
                    : 'Please upload the requested documents.'}
                </Alert>
              )}
              {(a.status === 'SUBMITTED' || a.status === 'RESUBMISSION_REQUESTED') && (
                <div>
                  <Button asChild>
                    <Link to={`/applications/${a.application_id}/upload`}>
                      {a.status === 'SUBMITTED'
                        ? 'Upload documents and submit'
                        : 'Upload new documents'}
                    </Link>
                  </Button>
                </div>
              )}
              {(a.status === 'AUTO_APPROVED' || a.status === 'APPROVED') && (
                <Alert tone="success" title="Your account is open">
                  You will receive your account details from the bank.
                </Alert>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              {a.documents.length === 0 ? (
                <p className="text-sm text-ink-soft">No documents uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm" aria-label="Documents">
                  {a.documents.map((d) => (
                    <li key={d.doc_id} className="flex justify-between gap-3 py-2">
                      <span>
                        {humanize(d.declared_doc_type)}{' '}
                        <span className="text-ink-soft">· {d.file_name}</span>
                      </span>
                      <span className="text-xs text-ink-soft">{formatBytes(d.size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-line">
                <Row label="Name" value={a.full_name} />
                <Row label="Date of birth" value={formatDate(a.dob)} />
                <Row label="PAN" value={a.pan_masked} />
                <Row label="Aadhaar" value={a.aadhaar_masked} />
                <Row label="Mobile" value={a.mobile} />
                <Row label="E-mail" value={a.email} />
                <Row label="Address" value={`${a.address}, ${a.pincode}`} />
                <Row label="Occupation" value={humanize(a.occupation_code)} />
                <Row label="Annual income" value={formatInr(a.annual_income)} />
              </dl>
            </CardContent>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {a.timeline.length ? (
              <Timeline steps={a.timeline} />
            ) : (
              <p className="text-sm text-ink-soft">No activity yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
