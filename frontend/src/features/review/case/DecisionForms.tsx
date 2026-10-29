import { useState, type FormEvent } from 'react';
import { submitCheckerDecision, submitRecommendation } from '@/api/client';
import { ApiError } from '@/api/http';
import { Field } from '@/components/common/Field';
import { useToast } from '@/components/toast/toast-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Option {
  value: string;
  label: string;
  help: string;
}

interface FormProps {
  applicationId: string;
  title: string;
  legend: string;
  options: Option[];
  minComment: number;
  note?: string;
  submitLabel: string;
  send: (action: string, comment: string) => Promise<string>;
  onDone: (message: string) => void;
}

function DecisionForm({
  applicationId,
  title,
  legend,
  options,
  minComment,
  note,
  submitLabel,
  send,
  onDone,
}: FormProps) {
  const toast = useToast();
  const [action, setAction] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{
    action?: string | undefined;
    comment?: string | undefined;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const e = {
      action: action ? undefined : 'Choose one option.',
      comment:
        comment.trim().length >= minComment
          ? undefined
          : minComment > 1
            ? `The comment must be at least ${minComment} characters (${comment.trim().length} so far).`
            : 'A comment is required.',
    };
    setErrors(e);
    return !e.action && !e.comment;
  }

  function next(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (validate()) setConfirming(true);
  }

  async function confirm() {
    setBusy(true);
    try {
      onDone(await send(action, comment.trim()));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reach the server.';
      setServerError(message);
      toast.error(message);
      setConfirming(false);
      setBusy(false);
    }
  }

  const chosen = options.find((o) => o.value === action);
  return (
    <form onSubmit={next} noValidate className="grid gap-3" aria-label={title}>
      <fieldset
        className="grid gap-2"
        aria-describedby={errors.action ? `${applicationId}-action-error` : undefined}
      >
        <legend className="mb-1 text-sm font-semibold">{legend}</legend>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex items-start gap-2 rounded-md border border-line bg-white p-2 text-sm has-[:checked]:border-forest has-[:checked]:bg-forest-soft/50"
          >
            <input
              type="radio"
              name={`${applicationId}-action`}
              value={o.value}
              checked={action === o.value}
              onChange={() => {
                setAction(o.value);
                setConfirming(false);
              }}
              className="mt-1 accent-forest"
            />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-xs text-ink-soft">{o.help}</span>
            </span>
          </label>
        ))}
        {errors.action && (
          <p id={`${applicationId}-action-error`} className="text-xs font-medium text-danger">
            {errors.action}
          </p>
        )}
      </fieldset>
      <Field
        id={`${applicationId}-comment`}
        label="Comment"
        required
        error={errors.comment}
        hint={
          minComment > 1
            ? `At least ${minComment} characters. Recorded in the audit trail.`
            : 'Recorded in the audit trail.'
        }
      >
        <Textarea
          className="min-h-20"
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setConfirming(false);
          }}
        />
      </Field>
      {note && <p className="text-xs text-ink-soft">{note}</p>}
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      {!confirming ? (
        <Button type="submit">{submitLabel}</Button>
      ) : (
        <div className="grid gap-2 rounded-lg border border-amber/40 bg-amber-soft p-3 text-sm">
          <p>
            Confirm: <strong>{chosen?.label}</strong>. This is recorded and cannot be undone from
            this screen.
          </p>
          <div className="flex gap-2">
            <Button type="button" loading={busy} onClick={() => void confirm()}>
              Confirm
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** KYC officer (maker): comment of at least 10 characters (spec section 3). The backend enforces it again. */
export function RecommendationForm({
  applicationId,
  onDone,
}: {
  applicationId: string;
  onDone: (message: string) => void;
}) {
  return (
    <DecisionForm
      applicationId={applicationId}
      title="Recommendation"
      legend="Your recommendation"
      minComment={10}
      submitLabel="Record recommendation"
      note="You cannot approve the case yourself: a different person decides."
      options={[
        {
          value: 'APPROVE',
          label: 'Recommend approval',
          help: 'The checker makes the final decision.',
        },
        {
          value: 'REJECT',
          label: 'Recommend rejection',
          help: 'The checker makes the final decision.',
        },
        {
          value: 'REQUEST_RESUBMISSION',
          label: 'Ask the applicant for new documents',
          help: 'The applicant gets a limited time to upload them.',
        },
      ]}
      send={async (action, comment) =>
        `Recommendation recorded. The case is now ${(await submitRecommendation(applicationId, { recommendation: action, comment })).status.toLowerCase().replace(/_/g, ' ')}.`
      }
      onDone={onDone}
    />
  );
}

/** Compliance officer (checker): the final approve / reject / send back. */
export function CheckerForm({
  applicationId,
  onDone,
}: {
  applicationId: string;
  onDone: (message: string) => void;
}) {
  return (
    <DecisionForm
      applicationId={applicationId}
      title="Checker decision"
      legend="Your decision"
      minComment={1}
      submitLabel="Record decision"
      note="You cannot decide a case you recommended or corrected: the server refuses it."
      options={[
        { value: 'APPROVE', label: 'Approve', help: 'The account is opened.' },
        { value: 'REJECT', label: 'Reject', help: 'The application is closed as rejected.' },
        { value: 'SEND_BACK', label: 'Send back to review', help: 'An officer looks at it again.' },
      ]}
      send={async (action, comment) => {
        const r = await submitCheckerDecision(applicationId, { action, comment });
        return r.account
          ? `Approved. Customer ${r.account.customer_id}, account ${r.account.account_number}.`
          : `Decision recorded. The case is now ${r.status.toLowerCase().replace(/_/g, ' ')}.`;
      }}
      onDone={onDone}
    />
  );
}
