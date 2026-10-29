import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OfficerLayout } from './OfficerLayout';
import { WrongPortalError } from './auth-context';
import { useAuth } from './useAuth';

function messageFor(err: unknown): string {
  if (err instanceof WrongPortalError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid e-mail or password.';
    if (err.status === 429) return err.message;
    if (err.status === 400) return 'Enter your work e-mail and password.';
  }
  return 'Sign-in failed. Check your connection and try again.';
}

/** Existing officers sign in with e-mail and password; new officers go to the registration page. */
export function OfficerLoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password, ['KYC_OFFICER', 'COMPLIANCE_OFFICER']);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <OfficerLayout>
      <Card aria-labelledby="officer-login-title" className="fx-glass rounded-2xl border-white/60">
        <CardHeader>
          <CardTitle id="officer-login-title">Officer sign in</CardTitle>
          <CardDescription>Use the work e-mail and password you registered with.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
            <label className="grid gap-1.5 text-sm font-medium">
              Work e-mail
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            {error && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" loading={busy} disabled={!email || !password}>
              Sign in
            </Button>
            <p className="text-sm text-ink-soft">
              New officer?{' '}
              <Link to="/officer/register" className="font-medium text-forest underline">
                Register with your enrollment code
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </OfficerLayout>
  );
}
