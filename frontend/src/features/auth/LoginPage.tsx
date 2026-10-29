import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid e-mail or password.';
    if (err.status === 429) return err.message;
    if (err.status === 400) return 'Enter your e-mail and password.';
  }
  return 'Sign-in failed. Check your connection and try again.';
}

export function LoginPage() {
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
      await signIn(email.trim(), password);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Card aria-labelledby="login-title" className="fx-glass rounded-2xl border-white/60">
        <CardHeader>
          <CardTitle id="login-title">Sign in</CardTitle>
          <CardDescription>Sign in to track your application.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
            <label className="grid gap-1.5 text-sm font-medium">
              E-mail
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
              New applicant?{' '}
              <Link to="/register" className="font-medium text-forest underline">
                Create an account
              </Link>
            </p>
            <p className="border-t border-line pt-3 text-sm text-ink-soft">
              Bank officer?{' '}
              <Link to="/officer/login" className="font-medium text-forest underline">
                Officer sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
