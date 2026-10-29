import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { stubApi } from '@/test/fake-api';
import { AuthProvider } from './AuthProvider';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );

async function fill(
  u: ReturnType<typeof userEvent.setup>,
  password = 'Long-enough-pass1',
  confirm = password,
) {
  await u.type(screen.getByLabelText(/Your name/), 'Neha Kapoor');
  await u.type(screen.getByLabelText(/E-mail/), 'neha@example.com');
  await u.type(screen.getByLabelText(/^Password/), password);
  await u.type(screen.getByLabelText(/Repeat the password/), confirm);
  await u.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('registration', () => {
  it('is linked from the login page', async () => {
    stubApi({});
    renderAt('/login');
    await userEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('checks the fields on screen and sends nothing when they are wrong', async () => {
    const calls = stubApi({});
    renderAt('/register');
    await fill(userEvent.setup(), 'short', 'other');
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('says when the e-mail is taken', async () => {
    stubApi({
      'POST /api/v1/auth/register': {
        status: 409,
        body: { error: 'EMAIL_TAKEN', message: 'taken' },
      },
    });
    renderAt('/register');
    await fill(userEvent.setup());
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it('creates the account without a role field, signs in and lands on the applicant home', async () => {
    const user = {
      id: 'u9',
      email: 'neha@example.com',
      display_name: 'Neha Kapoor',
      role: 'APPLICANT',
    };
    const calls = stubApi({
      'POST /api/v1/auth/register': { status: 201, body: { user } },
      'POST /api/v1/auth/login': {
        body: {
          token: 'oiq_x',
          token_type: 'Bearer',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          user,
        },
      },
      'GET /api/v1/applications/mine': { body: { applications: [] } },
    });
    renderAt('/register');
    await fill(userEvent.setup());
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/v1/applications/mine')).toBe(true),
    );
    const body = JSON.parse(
      calls.find((c) => c.key === 'POST /api/v1/auth/register')!.init!.body as string,
    );
    expect(body).toEqual({
      email: 'neha@example.com',
      password: 'Long-enough-pass1',
      display_name: 'Neha Kapoor',
    });
  });
});
