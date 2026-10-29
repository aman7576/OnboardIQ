import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMe, login, logout, type User } from '@/api/auth';
import { setUnauthorizedHandler } from '@/api/http';
import type { Role } from '@/api/types';
import { AuthContext, WrongPortalError, type AuthState } from './auth-context';
import { tokenStore } from './token-store';

export function AuthProvider({ children }: { children: ReactNode }) {
  // A stored session is trusted only after the server confirms it ("checking" in the meantime).
  const [state, setState] = useState<AuthState>(() =>
    tokenStore.read() ? { status: 'checking' } : { status: 'anonymous' },
  );

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setState({ status: 'anonymous' });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    if (state.status !== 'checking') return;
    let cancelled = false;
    fetchMe()
      .then(({ user }: { user: User }) => !cancelled && setState({ status: 'authenticated', user }))
      .catch(() => !cancelled && clearSession());
    return () => {
      cancelled = true;
    };
  }, [state.status, clearSession]);

  const signIn = useCallback(async (email: string, password: string, allowedRoles?: Role[]) => {
    const result = await login(email, password);
    if (allowedRoles && !allowedRoles.includes(result.user.role)) {
      // Wrong door: end the session the server just opened and keep nothing locally.
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${result.token}` },
      }).catch(() => undefined);
      throw new WrongPortalError(
        'This sign-in is for bank officers. Customers sign in from the main sign-in page.',
      );
    }
    tokenStore.write({ token: result.token, expires_at: result.expires_at, user: result.user });
    setState({ status: 'authenticated', user: result.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout(); // revokes the session on the server
    } catch {
      /* already expired or offline: the local session is cleared either way */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}
