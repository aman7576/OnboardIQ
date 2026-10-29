import type { RequestHandler } from 'express';

export type LogSink = (line: string) => void;

/**
 * One line per request: method, path, status, duration, user id.
 * Deliberately never logs headers, query strings, bodies or responses, so passwords, tokens,
 * PAN/Aadhaar values and document text cannot reach the log.
 */
export function requestLogger(sink: LogSink): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      sink(
        JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          path: req.originalUrl.split('?')[0], // full path as requested; the query string is dropped
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
          user: req.auth?.userId ?? null,
        }),
      );
    });
    next();
  };
}
