import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { register } from '@/api/auth';
import { ApiError } from '@/api/http';
import { Field } from '@/components/common/Field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

type Key = 'display_name' | 'email' | 'password' | 'confirm';
type Errors = Partial<Record<Key, string>>;

/** Applicant self-registration (spec section 3). The server always creates an APPLICANT; no role can be chosen. */
export function RegisterPage() {
  const { signIn } = useAuth();
  const [v, setV] = useState<Record<Key, string>>({
    display_name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function check(): Errors {
    const e: Errors = {};
    if (v.display_name.trim().length < 2)
      e.display_name = 'Enter your name (at least 2 characters).';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim()))
      e.email = 'Enter a valid e-mail address.';
    if (v.password.length < 12) e.password = 'Use at least 12 characters.';
    if (v.confirm !== v.password) e.confirm = 'The passwords do not match.';
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
      await register({
        email: v.email.trim(),
        password: v.password,
        display_name: v.display_name.trim(),
      });
      await signIn(v.email.trim(), v.password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        setErrors({ email: 'An account with this e-mail already exists. Sign in instead.' });
      else if (err instanceof ApiError && err.fields.length) {
        const e: Errors = {};
        for (const f of err.fields) e[f.field as Key] = `${f.field.replace('_', ' ')} ${f.message}`;
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

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <AuthLayout>
      <Card aria-labelledby="register-title" className="fx-glass rounded-2xl border-white/60">
        <CardHeader>
          <CardTitle id="register-title">Create an account</CardTitle>
          <CardDescription>
            To apply for a savings account. Bank staff accounts are created by the bank.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
            <Field id="r-name" label="Your name" required error={errors.display_name}>
              <Input autoComplete="name" value={v.display_name} onChange={set('display_name')} />
            </Field>
            <Field id="r-email" label="E-mail" required error={errors.email}>
              <Input type="email" autoComplete="email" value={v.email} onChange={set('email')} />
            </Field>
            <Field
              id="r-password"
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
            <Field id="r-confirm" label="Repeat the password" required error={errors.confirm}>
              <Input
                type="password"
                autoComplete="new-password"
                value={v.confirm}
                onChange={set('confirm')}
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" loading={busy}>
              Create account
            </Button>
            <p className="text-sm text-ink-soft">
              Already registered?{' '}
              <Link to="/login" className="font-medium text-forest underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
