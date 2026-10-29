import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { registerOfficer } from '@/api/auth';
import { ApiError } from '@/api/http';
import { Field } from '@/components/common/Field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OfficerLayout } from './OfficerLayout';
import { useAuth } from './useAuth';

type Key = 'display_name' | 'email' | 'role' | 'password' | 'confirm' | 'enrollment_code';
type Errors = Partial<Record<Key, string>>;
type OfficerRole = 'KYC_OFFICER' | 'COMPLIANCE_OFFICER';

/** New officers register with the enrollment code the bank gave them; the server checks it. */
export function OfficerRegisterPage() {
  const { signIn } = useAuth();
  const [v, setV] = useState<Record<Key, string>>({
    display_name: '',
    email: '',
    role: 'KYC_OFFICER',
    password: '',
    confirm: '',
    enrollment_code: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function check(): Errors {
    const e: Errors = {};
    if (v.display_name.trim().length < 2)
      e.display_name = 'Enter your name (at least 2 characters).';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()))
      e.email = 'Enter a valid work e-mail address.';
    if (v.password.length < 12) e.password = 'Use at least 12 characters.';
    if (v.confirm !== v.password) e.confirm = 'The passwords do not match.';
    if (!v.enrollment_code.trim()) e.enrollment_code = 'Enter the enrollment code from the bank.';
    return e;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await registerOfficer({
        email: v.email.trim(),
        password: v.password,
        display_name: v.display_name.trim(),
        role: v.role as OfficerRole,
        enrollment_code: v.enrollment_code.trim(),
      });
      await signIn(v.email.trim(), v.password);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_ENROLLMENT_CODE')
        setErrors({ enrollment_code: 'This enrollment code is not valid.' });
      else if (err instanceof ApiError && err.status === 409)
        setErrors({ email: 'An account with this e-mail already exists. Sign in instead.' });
      else if (err instanceof ApiError && err.code === 'STAFF_REGISTRATION_DISABLED')
        setError('Officer registration is not enabled. Please contact your administrator.');
      else if (err instanceof ApiError && err.status === 429) setError(err.message);
      else if (err instanceof ApiError && err.fields.length) {
        const e: Errors = {};
        for (const f of err.fields)
          e[f.field as Key] = `${f.field.replaceAll('_', ' ')} ${f.message}`;
        setErrors(e);
      } else
        setError(
          err instanceof ApiError
            ? err.message
            : 'Registration failed. Check your connection and try again.',
        );
      setBusy(false);
    }
  }

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <OfficerLayout>
      <Card
        aria-labelledby="officer-register-title"
        className="fx-glass rounded-2xl border-white/60"
      >
        <CardHeader>
          <CardTitle id="officer-register-title">Officer registration</CardTitle>
          <CardDescription>
            For new bank officers. You need the enrollment code issued by your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
            <Field id="o-name" label="Full name" required error={errors.display_name}>
              <Input autoComplete="name" value={v.display_name} onChange={set('display_name')} />
            </Field>
            <Field id="o-email" label="Work e-mail" required error={errors.email}>
              <Input type="email" autoComplete="email" value={v.email} onChange={set('email')} />
            </Field>
            <Field id="o-role" label="Role" required error={errors.role}>
              <Select value={v.role} onChange={set('role')}>
                <option value="KYC_OFFICER">KYC Officer (reviews cases)</option>
                <option value="COMPLIANCE_OFFICER">Compliance Officer (final decisions)</option>
              </Select>
            </Field>
            <Field
              id="o-password"
              label="Password"
              required
              hint="At least 12 characters."
              error={errors.password}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={v.password}
                onChange={set('password')}
              />
            </Field>
            <Field id="o-confirm" label="Repeat the password" required error={errors.confirm}>
              <Input
                type="password"
                autoComplete="new-password"
                value={v.confirm}
                onChange={set('confirm')}
              />
            </Field>
            <Field
              id="o-code"
              label="Enrollment code"
              required
              hint="Given to you by the bank when you joined."
              error={errors.enrollment_code}
            >
              <Input
                autoComplete="off"
                value={v.enrollment_code}
                onChange={set('enrollment_code')}
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" loading={busy}>
              Create officer account
            </Button>
            <p className="text-sm text-ink-soft">
              Already registered?{' '}
              <Link to="/officer/login" className="font-medium text-forest underline">
                Officer sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </OfficerLayout>
  );
}
