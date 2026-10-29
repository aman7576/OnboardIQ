import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './errors.js';
import { redactSecrets } from './redact.js';

export const routeNotFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
};

/** Bodies that fail to parse (malformed JSON, too large) arrive from Express with a status. */
function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

// Last-resort handler: detail goes to the (redacted) log, clients get a generic body.
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  const status = statusOf(err);
  if (err instanceof HttpError) {
    if (err.status === 401) res.set('WWW-Authenticate', 'Bearer');
    res.status(status).json({
      error: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
    return;
  }
  if (status >= 500) {
    console.error(
      '[error]',
      redactSecrets(err instanceof Error ? (err.stack ?? err.message) : String(err)),
    );
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
    return;
  }
  res.status(status).json({ error: 'BAD_REQUEST', message: 'Malformed request' });
};
