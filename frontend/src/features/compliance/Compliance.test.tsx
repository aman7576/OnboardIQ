import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { STATUSES, type Dashboard } from '@/api/types';
import { renderAppAs } from '@/test/render';

const zero = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Dashboard['by_status'];
const DASH: Dashboard = {
  range: { from: null, to: null },
  total_applications: 60,
  by_status: { ...zero, APPROVED: 7, IN_REVIEW: 21 },
  decided: { count: 60, approve: 30, review: 20, reject: 10 },
  rates: { straight_through: 0.5, review: 1 / 3, reject: 1 / 6 },
  top_reason_codes: [{ code: 'LOW_EXTRACTION_CONFIDENCE', count: 9 }],
  review_time: { average_seconds: 5400, completed_reviews: 4, open_reviews: 2 },
  pending_checker: { count: 3, overdue: 1, sla_hours: 24 },
  definitions: { straight_through: 'Approved by the rules without a person.' },
};

describe('compliance dashboard', () => {
  it('shows exactly the figures the API returned', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/dashboard', {
      'GET /api/v1/admin/dashboard': { body: DASH },
      'GET /api/v1/health': {
        body: { status: 'ok', service: 's', version: '1', environment: 'test', time: 'x' },
      },
      'GET /api/v1/health/db': { body: { status: 'ok', database: 'up', latencyMs: 1 } },
    });
    expect(await screen.findByTestId('stat-total')).toHaveTextContent('60');
    expect(screen.getByTestId('stat-stp')).toHaveTextContent('50.0%');
    expect(screen.getByTestId('stat-review')).toHaveTextContent('33.3%');
    expect(screen.getByTestId('stat-pending')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-review-time')).toHaveTextContent('1.5 h');
    expect(screen.getByTestId('status-IN_REVIEW')).toHaveTextContent('21');
    expect(screen.getByText('Low extraction confidence')).toBeInTheDocument();
  });

  it('explains received-but-unprocessed applications instead of showing silent 0% rates', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/dashboard', {
      'GET /api/v1/admin/dashboard': {
        body: { ...DASH, by_status: { ...DASH.by_status, SUBMITTED: 160 } },
      },
      'GET /api/v1/health': { status: 503 },
      'GET /api/v1/health/db': { status: 503 },
    });
    expect(
      await screen.findByText('160 application(s) received but not processed yet'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Maintenance' })).toHaveLength(2); // menu + the notice
  });

  it('shows n/a, not 0%, when no application has been decided', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/dashboard', {
      'GET /api/v1/admin/dashboard': {
        body: {
          ...DASH,
          total_applications: 2,
          decided: { count: 0, approve: 0, review: 0, reject: 0 },
          rates: { straight_through: null, review: null, reject: null },
          review_time: { average_seconds: null, completed_reviews: 0, open_reviews: 0 },
        },
      },
      'GET /api/v1/health': { status: 503 },
      'GET /api/v1/health/db': { status: 503 },
    });
    expect(await screen.findByTestId('stat-stp')).toHaveTextContent('n/a');
    expect(screen.getByTestId('stat-review-time')).toHaveTextContent('n/a');
  });

  it('shows an empty state for a period without applications, and an error with retry', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/dashboard', {
      'GET /api/v1/admin/dashboard': { body: { ...DASH, total_applications: 0 } },
      'GET /api/v1/health': { status: 503 },
      'GET /api/v1/health/db': { status: 503 },
    });
    expect(await screen.findByText('No applications in this period')).toBeInTheDocument();
  });

  it('sends the chosen date range to the API', async () => {
    const calls = renderAppAs('COMPLIANCE_OFFICER', '/dashboard', {
      'GET /api/v1/admin/dashboard': { body: DASH },
      'GET /api/v1/admin/dashboard?from=2026-10-01': { body: DASH },
      'GET /api/v1/health': { status: 503 },
      'GET /api/v1/health/db': { status: 503 },
    });
    await screen.findByTestId('stat-total');
    await userEvent.type(screen.getByLabelText('Applied from'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/v1/admin/dashboard?from=2026-10-01')).toBe(true),
    );
  });
});

describe('audit viewer', () => {
  const EVENTS = [
    {
      id: '1',
      type: 'STATUS_CHANGED',
      at: '2026-10-01T04:00:00Z',
      actor_user_id: 'u',
      actor_name: 'Anita Rao',
      actor_role: 'KYC_OFFICER',
      doc_id: null,
      before: { status: 'IN_REVIEW' },
      after: { status: 'PENDING_CHECKER' },
      details: null,
    },
    {
      id: '2',
      type: 'DOCUMENT_VIEWED',
      at: '2026-10-01T03:00:00Z',
      actor_user_id: 'u',
      actor_name: 'Anita Rao',
      actor_role: 'KYC_OFFICER',
      doc_id: 'D1',
      before: null,
      after: null,
      details: null,
    },
  ];

  it('prompts for an application number, then lists its events with names and expandable details', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/audit?application=A2000009', {
      'GET /api/v1/admin/audit/A2000009': { body: { events: EVENTS } },
    });
    expect((await screen.findAllByText('Status changed')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anita Rao').length).toBe(2);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText(/PENDING_CHECKER/)).toBeInTheDocument();
  });

  it('asks for a number first and shows a server error clearly', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/audit', {});
    expect(await screen.findByText('Enter an application number')).toBeInTheDocument();
  });

  it('shows an error when the application does not exist', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/audit?application=NOPE', {
      'GET /api/v1/admin/audit/NOPE': {
        status: 404,
        body: { error: 'NOT_FOUND', message: 'Not found' },
      },
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('AI evaluation', () => {
  it('says the evaluation has not been generated when the server has no files', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/ai-evaluation', {
      'GET /api/v1/admin/ai-evaluation': {
        status: 404,
        body: { error: 'NOT_FOUND', message: 'Run `npm run outputs`' },
      },
    });
    expect(await screen.findByText('No evaluation has been generated yet')).toBeInTheDocument();
  });
});

describe('role navigation', () => {
  const QUEUE = { 'GET /api/v1/review/queue': { body: { queue: 'review', applications: [] } } };
  it('shows each role only its own links', async () => {
    renderAppAs('KYC_OFFICER', '/review', QUEUE);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Review queue' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'My applications' })).not.toBeInTheDocument();
  });

  it('does not render another role’s page (the server still authorises every request)', async () => {
    const calls = renderAppAs('APPLICANT', '/audit', {});
    expect(await screen.findByText('This page is not for your role')).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('/admin/'))).toBe(false);
  });

  it('lands each role on its own home', async () => {
    renderAppAs('COMPLIANCE_OFFICER', '/', {
      'GET /api/v1/admin/dashboard': { body: DASH },
      'GET /api/v1/health': { status: 503 },
      'GET /api/v1/health/db': { status: 503 },
    });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
