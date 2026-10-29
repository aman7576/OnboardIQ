import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { stubApi } from '@/test/fake-api';
import { SystemStatus } from './SystemStatus';

describe('SystemStatus', () => {
  it('shows the backend and database as Up with their details', async () => {
    stubApi({
      'GET /api/v1/health': {
        body: {
          status: 'ok',
          service: 'onboardiq-api',
          version: '0.1.0',
          environment: 'development',
          time: 'x',
        },
      },
      'GET /api/v1/health/db': { body: { status: 'ok', database: 'up', latencyMs: 7 } },
    });
    render(<SystemStatus />);
    expect(await screen.findByText('v0.1.0 · development')).toBeInTheDocument();
    expect(await screen.findByText('7 ms')).toBeInTheDocument();
    expect(screen.getAllByText('Up')).toHaveLength(2);
  });

  it('shows Down when the database check fails (503) and when the backend is unreachable', async () => {
    stubApi({
      'GET /api/v1/health': {
        body: {
          status: 'ok',
          service: 'onboardiq-api',
          version: '0.1.0',
          environment: 'test',
          time: 'x',
        },
      },
      'GET /api/v1/health/db': {
        status: 503,
        body: { status: 'error', database: 'down', message: 'Database unreachable' },
      },
    });
    render(<SystemStatus />);
    expect(await screen.findByText('Database unreachable')).toBeInTheDocument();
    expect(screen.getAllByText('Down')).toHaveLength(1);
  });

  it('refresh asks the backend again', async () => {
    const calls = stubApi({
      'GET /api/v1/health': {
        body: { status: 'ok', service: 's', version: '1', environment: 'test', time: 'x' },
      },
      'GET /api/v1/health/db': { body: { status: 'ok', database: 'up', latencyMs: 1 } },
    });
    render(<SystemStatus />);
    await screen.findAllByText('Up');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findAllByText('Up');
    expect(calls.filter((c) => c.key === 'GET /api/v1/health')).toHaveLength(2);
  });
});
