import type { RequestHandler } from 'express';

/** Runs several (possibly async) middlewares in order as one; the first error stops the chain. */
export function chain(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    let index = 0;
    const step = (err?: unknown): void => {
      if (err) return next(err);
      const handler = handlers[index++];
      if (!handler) return next();
      try {
        Promise.resolve(handler(req, res, step)).catch(next);
      } catch (e) {
        next(e);
      }
    };
    step();
  };
}
