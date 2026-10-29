import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';
import { OFFICER, stubApi } from '@/test/fake-api';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { AuthProvider } from './AuthProvider';
import { tokenStore } from './token-store';

const QUEUE = { 'GET /api/v1/review/queue': { body: { queue: 'review', applications: [] } } };

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('E-mail'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign in', () => {
  it('shows the login page to a visitor and keeps Sign in disabled until both fields are filled', async () => {
    stubApi({});
    renderApp();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@b.c');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    expect(submit).toBeEnabled();
  });

  it('signs in, stores the session, and shows the user with their role', async () => {
    const calls = stubApi({
      'POST /api/v1/auth/login': {
        body: {
          token: 'oiq_test_token',
          token_type: 'Bearer',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          user: OFFICER,
        },
      },
      ...QUEUE,
    });
    renderApp();
    await fillAndSubmit('officer1@onboardiq.test', 'Some-Password-1');

    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument();
    expect(screen.getAllByText(/KYC officer/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anita Rao').length).toBeGreaterThan(0);
    expect(tokenStore.read()?.token).toBe('oiq_test_token');
    const login = calls.find((c) => c.key === 'POST /api/v1/auth/login');
    expect(JSON.parse(login?.init?.body as string)).toEqual({
      email: 'officer1@onboardiq.test',
      password: 'Some-Password-1',
    });
  });

  it('shows one generic message for wrong credentials and stays on the login page', async () => {
    stubApi({
      'POST /api/v1/auth/login': {
        status: 401,
        body: { error: 'INVALID_CREDENTIALS', message: 'Invalid e-mail or password' },
      },
    });
    renderApp();
    await fillAndSubmit('officer1@onboardiq.test', 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid e-mail or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(tokenStore.read()).toBeNull();
    expect(screen.getByLabelText('Password')).toBeEnabled(); // can try again
  });

  it('shows the lock-out message from the server (429)', async () => {
    stubApi({
      'POST /api/v1/auth/login': {
        status: 429,
        body: {
          error: 'TOO_MANY_REQUESTS',
          message: 'Too many failed attempts. Try again in 900 seconds.',
        },
      },
    });
    renderApp();
    await fillAndSubmit('a@b.c', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed attempts');
  });

  it('reports a network failure without a stack trace', async () => {
    stubApi({}); // every request is unexpected -> fetch rejects
    renderApp();
    await fillAndSubmit('a@b.c', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed');
  });
});

describe('session handling', () => {
  const session = (expires: number) => ({
    token: 'oiq_stored',
    expires_at: new Date(expires).toISOString(),
    user: OFFICER,
  });

  it('restores a stored session after the server confirms it', async () => {
    tokenStore.write(session(Date.now() + 3_600_000));
    const calls = stubApi({ 'GET /api/v1/auth/me': { body: { user: OFFICER } }, ...QUEUE });
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument();
    const me = calls.find((c) => c.key === 'GET /api/v1/auth/me');
    expect((me?.init?.headers as Record<string, string>).Authorization).toBe('Bearer oiq_stored');
  });

  it('falls back to the login page when the server says the session is revoked', async () => {
    tokenStore.write(session(Date.now() + 3_600_000));
    stubApi({
      'GET /api/v1/auth/me': {
        status: 401,
        body: { error: 'UNAUTHENTICATED', message: 'Invalid or expired session' },
      },
    });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(tokenStore.read()).toBeNull();
  });

  it('ignores a locally expired session without calling the server', () => {
    tokenStore.write(session(Date.now() - 1000));
    const calls = stubApi({});
    renderApp();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('signing out revokes the session on the server and clears it locally', async () => {
    tokenStore.write(session(Date.now() + 3_600_000));
    const calls = stubApi({
      'GET /api/v1/auth/me': { body: { user: OFFICER } },
      'POST /api/v1/auth/logout': { status: 204 },
      ...QUEUE,
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sign out' }))[0]!);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.key === 'POST /api/v1/auth/logout')).toBe(true);
    expect(tokenStore.read()).toBeNull();
  });
});
