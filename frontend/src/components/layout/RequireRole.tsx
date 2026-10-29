import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '@/api/types';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/features/auth/useAuth';

/**
 * Convenience guard: it only decides what the screen shows. It is NOT authorisation; every request is checked
 * again by the backend, which answers 403/404 for anything the user may not do or see.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'checking')
    return (
      <p role="status" className="py-16 text-ink-soft">
        Checking your session…
      </p>
    );
  if (state.status !== 'authenticated')
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(state.user.role))
    return (
      <Alert tone="warning" title="This page is not for your role">
        Use the menu to open one of your pages.
      </Alert>
    );
  return <>{children}</>;
}
