import { vi } from 'vitest';

export type Reply = { status?: number; body?: unknown };
export type Handler = (init: RequestInit | undefined) => Reply;

/** Replaces fetch with a table of "METHOD /path" handlers and returns the call log. */
export function stubApi(routes: Record<string, Handler | Reply>) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${input}`;
      calls.push({ key, init });
      const route = routes[key];
      if (!route) return Promise.reject(new Error(`unexpected request: ${key}`));
      const { status = 200, body } = typeof route === 'function' ? route(init) : route;
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}

export const OFFICER = {
  id: 'u-1',
  email: 'officer1@onboardiq.test',
  display_name: 'Anita Rao',
  role: 'KYC_OFFICER',
} as const;

export const HEALTH_OK = {
  'GET /api/v1/health': {
    body: {
      status: 'ok',
      service: 'onboardiq-api',
      version: '0.1.0',
      environment: 'test',
      time: 'x',
    },
  },
  'GET /api/v1/health/db': { body: { status: 'ok', database: 'up', latencyMs: 4 } },
};
