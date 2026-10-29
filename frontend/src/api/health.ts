export interface ServiceHealth {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  time: string;
}

export interface DatabaseHealth {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  latencyMs?: number;
  message?: string;
}

async function getJson<T>(path: string): Promise<{ httpStatus: number; body: T }> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  return { httpStatus: res.status, body: (await res.json()) as T };
}

export const fetchServiceHealth = () => getJson<ServiceHealth>('/api/v1/health');
export const fetchDatabaseHealth = () => getJson<DatabaseHealth>('/api/v1/health/db');
