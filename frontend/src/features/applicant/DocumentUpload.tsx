import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  getApplicantApplication,
  resubmitApplication,
  submitApplication,
  uploadDocuments,
} from '@/api/client';
import { ApiError } from '@/api/http';
import type { UploadedDocument } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, LoadingState } from '@/components/common/States';
import { useToast } from '@/components/toast/toast-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes, humanize } from '@/lib/format';

const TYPES = [
  'PAN_CARD',
  'AADHAAR_CARD',
  'ELECTRICITY_BILL',
  'BANK_STATEMENT',
  'DRIVING_LICENCE',
] as const;
const MAX_BYTES = 1024 * 1024; // 1 MB per file (spec FR-2); the server checks it again

interface Chosen {
  key: string;
  file: File;
  type: string;
  problem: string | null;
}

/** Guess for the dropdown only, from the file name; the applicant can change it and the backend never trusts it as the real type. */
const guessType = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes('pan')) return 'PAN_CARD';
  if (n.includes('aadhaar') || n.includes('aadhar')) return 'AADHAAR_CARD';
  if (n.includes('bill') || n.includes('electric')) return 'ELECTRICITY_BILL';
  if (n.includes('statement') || n.includes('bank')) return 'BANK_STATEMENT';
  if (n.includes('licen') || n.includes('driving')) return 'DRIVING_LICENCE';
  return 'PAN_CARD';
};

function problemWith(file: File): string | null {
  if (!/\.(txt|pdf|png|jpe?g)$/i.test(file.name))
    return 'Only .txt, .pdf, .png and .jpg files are accepted.';
  if (file.size > MAX_BYTES) return `This file is ${formatBytes(file.size)}; the limit is 1 MB.`;
  if (file.size === 0) return 'This file is empty.';
  return null;
}

export function DocumentUpload() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const app = useAsync(() => getApplicantApplication(id), [id]);
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [uploaded, setUploaded] = useState<UploadedDocument[]>([]);
  const [serverProblems, setServerProblems] = useState<Record<number, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'upload' | 'submit' | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (app.status === 'loading') return <LoadingState label="Loading the application" />;
  if (app.status === 'error') return <ErrorState error={app.error} onRetry={app.reload} />;
  const a = app.data;
  const canUpload = a.status === 'SUBMITTED' || a.status === 'RESUBMISSION_REQUESTED';
  const resubmitting = a.status === 'RESUBMISSION_REQUESTED';
  const firstUpload = a.documents.length === 0;

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    setChosen((current) => [
      ...current,
      ...files.map((file, i) => ({
        key: `${file.name}-${file.size}-${Date.now()}-${i}`,
        file,
        type: guessType(file.name),
        problem: problemWith(file),
      })),
    ]);
    setServerProblems({});
    setFormProblem(null);
    e.target.value = '';
  }

  async function upload() {
    setServerProblems({});
    setFormProblem(null);
    setBusy('upload');
    try {
      const result = await uploadDocuments(
        a.application_id,
        chosen.map((c) => ({ file: c.file, declaredType: c.type })),
      );
      setUploaded((u) => [...u, ...result.documents]);
      setChosen([]);
      const dupes = result.documents.filter((d) => d.duplicate).length;
      toast.success(
        `${result.documents.length - dupes} document(s) uploaded${dupes ? `, ${dupes} already on file` : ''}.`,
      );
      app.reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        const byIndex: Record<number, string> = {};
        const general: string[] = [];
        for (const f of err.fields) {
          const m = /^files\[(\d+)\]$/.exec(f.field);
          if (m) byIndex[Number(m[1])] = f.message.replace(/^[A-Z_]+: /, '');
          else general.push(f.message);
        }
        setServerProblems(byIndex);
        setFormProblem(general.length ? general.join(' ') : err.message);
      } else setFormProblem(err instanceof ApiError ? err.message : 'Could not reach the server.');
      toast.error('The documents were not uploaded.');
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy('submit');
    try {
      const result = await (resubmitting ? resubmitApplication : submitApplication)(
        a.application_id,
      );
      toast.success(
        resubmitting
          ? 'Documents resubmitted. Your application is being checked again.'
          : 'Application submitted. We are checking it now.',
      );
      void navigate(`/applications/${result.application_id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not reach the server.');
      setBusy(null);
      app.reload();
    }
  }

  const blocked = chosen.some((c) => c.problem);
  return (
    <>
      <PageHeader
        eyebrow={`Application ${a.application_id}`}
        title={resubmitting ? 'Upload new documents' : 'Upload your documents'}
        description="Upload text (.txt), PDF or photo (.png, .jpg) copies of your PAN card, Aadhaar card and an address proof (electricity bill, bank statement or driving licence)."
        actions={<StatusBadge status={a.status} />}
      />
      {!canUpload && (
        <Alert tone="warning" title="Documents cannot be added now">
          This application is {a.status.toLowerCase().replace(/_/g, ' ')}.{' '}
          <Link className="underline" to={`/applications/${a.application_id}`}>
            Back to the application
          </Link>
        </Alert>
      )}
      {canUpload && (
        <div className="grid max-w-3xl gap-6">
          {resubmitting && (
            <Alert tone="warning" title="Documents were requested">
              {a.reasons.length ? (
                <ul className="list-disc pl-5">
                  {a.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                'Please upload the documents the officer asked for.'
              )}
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Choose files</CardTitle>
              <CardDescription>
                {firstUpload
                  ? 'Your first submission needs at least 3 files: PAN, Aadhaar and an address proof. '
                  : ''}
                Each file must be a .txt (UTF-8), .pdf, .png or .jpg, at most 1 MB. Photos and
                scanned PDFs are read with OCR. Choose a document type for each.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <input
                  ref={input}
                  id="files"
                  type="file"
                  accept=".txt,.pdf,.png,.jpg,.jpeg,text/plain,application/pdf,image/png,image/jpeg"
                  multiple
                  className="sr-only"
                  onChange={onPick}
                />
                <Button type="button" variant="outline" onClick={() => input.current?.click()}>
                  Choose files
                </Button>
                <label htmlFor="files" className="sr-only">
                  Choose files
                </label>
              </div>
              {formProblem && <Alert tone="danger">{formProblem}</Alert>}
              {chosen.length === 0 ? (
                <p className="text-sm text-ink-soft">No files chosen yet.</p>
              ) : (
                <ul className="grid gap-3" aria-label="Files to upload">
                  {chosen.map((c, i) => (
                    <li
                      key={c.key}
                      className="grid gap-2 rounded-lg border border-line bg-white p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.file.name}</p>
                        <p className="text-xs text-ink-soft">{formatBytes(c.file.size)}</p>
                        {(c.problem ?? serverProblems[i]) && (
                          <p role="alert" className="mt-1 text-xs font-medium text-danger">
                            {c.problem ?? serverProblems[i]}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`type-${c.key}`} className="sr-only">
                          Document type for {c.file.name}
                        </label>
                        <Select
                          id={`type-${c.key}`}
                          value={c.type}
                          onChange={(e) =>
                            setChosen((all) =>
                              all.map((x) =>
                                x.key === c.key ? { ...x, type: e.target.value } : x,
                              ),
                            )
                          }
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t}>
                              {humanize(t)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setChosen((all) => all.filter((x) => x.key !== c.key))}
                        aria-label={`Remove ${c.file.name}`}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  type="button"
                  loading={busy === 'upload'}
                  disabled={chosen.length === 0 || blocked || busy !== null}
                  onClick={() => void upload()}
                >
                  Upload {chosen.length || ''} file{chosen.length === 1 ? '' : 's'}
                </Button>
              </div>
            </CardContent>
          </Card>
          {(a.documents.length > 0 || uploaded.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Uploaded documents</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-line text-sm" aria-label="Uploaded documents">
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
                {uploaded.some((d) => d.duplicate) && (
                  <p className="mt-3 text-xs text-ink-soft">
                    A file that was already on your application is kept once; it was not added
                    again.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              loading={busy === 'submit'}
              disabled={a.documents.length === 0 || busy !== null}
              onClick={() => void submit()}
            >
              {resubmitting ? 'Resubmit for checking' : 'Submit application'}
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <Link to={`/applications/${a.application_id}`}>Save and come back later</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
