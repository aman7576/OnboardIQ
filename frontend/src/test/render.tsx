import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { App } from '@/App';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { tokenStore } from '@/features/auth/token-store';
import type { Role } from '@/api/types';
import { stubApi, type Handler, type Reply } from './fake-api';

export const USERS: Record<Role, { id: string; email: string; display_name: string; role: Role }> =
  {
    APPLICANT: {
      id: 'u-a',
      email: 'applicant1@onboardiq.test',
      display_name: 'Asha Verma',
      role: 'APPLICANT',
    },
    KYC_OFFICER: {
      id: 'u-o',
      email: 'officer1@onboardiq.test',
      display_name: 'Anita Rao',
      role: 'KYC_OFFICER',
    },
    COMPLIANCE_OFFICER: {
      id: 'u-c',
      email: 'checker1@onboardiq.test',
      display_name: 'Chandan Iyer',
      role: 'COMPLIANCE_OFFICER',
    },
  };

/** Renders a component inside the router and toasts. */
export const renderWithProviders = (ui: ReactElement, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

/** Signs the role in (session confirmed by /auth/me), stubs the API with `routes`, renders the whole app at `path`. */
export function renderAppAs(role: Role, path: string, routes: Record<string, Reply | Handler>) {
  tokenStore.write({
    token: 'oiq_test',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    user: USERS[role],
  });
  const calls = stubApi({ 'GET /api/v1/auth/me': { body: { user: USERS[role] } }, ...routes });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
  return calls;
}
