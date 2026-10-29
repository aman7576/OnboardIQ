import { tokenStore } from '@/features/auth/token-store';

export interface FieldIssue {
  field: string;
  message: string;
}

/** An error response from the API: status, machine code, readable message, and field problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called when a request made with a stored token comes back 401 (expired or revoked session). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  fields?: unknown;
}

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

function asFields(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const issue = item as Partial<FieldIssue> | null;
    return typeof issue?.field === 'string' && typeof issue.message === 'string'
      ? [{ field: issue.field, message: issue.message }]
      : [];
  });
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** multipart upload: the browser sets the Content-Type with its boundary */
  form?: FormData;
}

export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  const token = tokenStore.read()?.token;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.form
      ? { body: options.form }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const body = (data ?? {}) as ErrorBody;
    throw new ApiError(
      res.status,
      asText(body.error, 'ERROR'),
      asText(body.message, res.statusText || 'Request failed'),
      asFields(body.fields),
    );
  }
  return data as T;
}

/** Downloads a file with the user's token (for example the audit CSV). */
export async function apiDownload(path: string): Promise<Blob> {
  const token = tokenStore.read()?.token;
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const data = (await res.json().catch(() => null)) as ErrorBody | null;
    throw new ApiError(
      res.status,
      asText(data?.error, 'ERROR'),
      asText(data?.message, res.statusText || 'Download failed'),
    );
  }
  return res.blob();
}
