import { useState } from 'react';
import { getDocumentText } from '@/api/client';
import { ApiError } from '@/api/http';
import type { DocumentText, StaffDocument } from '@/api/types';
import { ConfidenceMeter } from '@/components/common/ConfidenceMeter';
import { Field } from '@/components/common/Field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { humanize } from '@/lib/format';
import { correctionKey, FIELD_HINTS, valueProblem } from './fieldFormats';

export interface PendingCorrection {
  doc_id: string;
  field_name: string;
  new_value: string;
  reason: string;
}

interface Props {
  applicationId: string;
  doc: StaffDocument;
  limit: number; // minimum confidence, from the backend configuration
  canCorrect: boolean;
  pending: Map<string, PendingCorrection>;
  onAdd: (c: PendingCorrection) => void;
}

function FieldRow({
  doc,
  field,
  limit,
  canCorrect,
  pending,
  onAdd,
}: {
  doc: StaffDocument;
  field: StaffDocument['extracted_fields'][number];
  limit: number;
  canCorrect: boolean;
  pending: PendingCorrection | undefined;
  onAdd: (c: PendingCorrection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ value?: string | undefined; reason?: string | undefined }>(
    {},
  );
  const low = field.confidence < limit;
  const id = `${doc.doc_id}-${field.field_name}`;

  function add() {
    const e = {
      value: valueProblem(field.field_name, value) ?? undefined,
      reason: reason.trim() ? undefined : 'A reason is required for every correction.',
    };
    setErrors(e);
    if (e.value || e.reason) return;
    onAdd({
      doc_id: doc.doc_id,
      field_name: field.field_name,
      new_value: value.trim(),
      reason: reason.trim(),
    });
    setEditing(false);
    setValue('');
    setReason('');
  }

  return (
    <li
      className={cn(
        'rounded-lg border p-3',
        low ? 'border-danger/40 bg-danger-soft/60' : 'border-line bg-white',
      )}
      data-low={low || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs text-ink-soft">{humanize(field.field_name)}</p>
          <p className="font-mono text-sm break-words">{field.value}</p>
          {pending && (
            <p className="mt-1 text-xs font-medium text-forest">
              Pending correction to <span className="font-mono">{pending.new_value}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <ConfidenceMeter value={field.confidence} limit={limit} />
          <span className="flex items-center gap-2">
            {field.source === 'OFFICER' && <Badge tone="info">Corrected by an officer</Badge>}
            {canCorrect && !editing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                aria-label={`Correct ${humanize(field.field_name)} of ${doc.doc_id}`}
              >
                Correct
              </Button>
            )}
          </span>
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3">
          <Field
            id={`${id}-value`}
            label="Corrected value"
            hint={FIELD_HINTS[field.field_name]}
            error={errors.value}
            required
          >
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field
            id={`${id}-reason`}
            label="Reason for the correction"
            error={errors.reason}
            required
            hint="Recorded with the old and new value in the audit trail."
          >
            <Textarea
              className="min-h-16"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={add}>
              Add correction
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setErrors({});
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Extracted values (left) next to the source text of the same document (right). */
export function DocumentReview({ applicationId, doc, limit, canCorrect, pending, onAdd }: Props) {
  const [text, setText] = useState<DocumentText | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = doc.extracted_fields.find((f) => f.field_name === 'doc_type');
  const mismatch = type && type.value !== doc.declared_doc_type;
  const fields = [...doc.extracted_fields].sort((a, b) =>
    a.field_name === 'doc_type' ? -1 : b.field_name === 'doc_type' ? 1 : 0,
  );

  async function show() {
    setLoading(true);
    setError(null);
    try {
      setText(await getDocumentText(applicationId, doc.doc_id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the document.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>
            {humanize(doc.declared_doc_type)}{' '}
            <span className="font-sans text-xs font-normal text-ink-soft">declared</span>
          </span>
          <span className="font-mono text-xs font-normal text-ink-soft">{doc.doc_id}</span>
          {mismatch && <Badge tone="warning">Read as {humanize(type.value)}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <section aria-label={`Extracted values of ${doc.doc_id}`}>
          <h3 className="mb-2 text-sm font-semibold">Extracted values</h3>
          {fields.length === 0 ? (
            <p className="text-sm text-ink-soft">Nothing was extracted from this document.</p>
          ) : (
            <ul className="grid gap-2">
              {fields.map((f) => (
                <FieldRow
                  key={f.field_name}
                  doc={doc}
                  field={f}
                  limit={limit}
                  canCorrect={canCorrect}
                  pending={pending.get(
                    correctionKey({ doc_id: doc.doc_id, field_name: f.field_name }),
                  )}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          )}
        </section>
        <section aria-label={`Source text of ${doc.doc_id}`}>
          <h3 className="mb-2 text-sm font-semibold">Document text</h3>
          {!text && (
            <div className="rounded-lg border border-dashed border-line p-4 text-sm">
              <p className="text-ink-soft">Opening a document is recorded in the audit log.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                loading={loading}
                onClick={() => void show()}
              >
                Show document text
              </Button>
              {error && (
                <p role="alert" className="mt-2 text-xs font-medium text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
          {text && (
            <>
              {/* The text is untrusted data: it is rendered as plain text and never interpreted. */}
              <pre
                tabIndex={0}
                aria-label={`Text of ${doc.doc_id}`}
                className="max-h-96 overflow-auto rounded-lg border border-line bg-white p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
              >
                {text.text}
              </pre>
              <p className="mt-1 font-mono text-[0.65rem] text-ink-soft">
                sha256 {text.sha256.slice(0, 16)}…
              </p>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
