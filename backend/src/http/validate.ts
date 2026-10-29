import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses untrusted input; failures become a 400 that names every offending field (FR-2). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw badRequest(
    'Validation failed',
    result.error.issues.map((i) => ({
      field: i.path.join('.') || '(body)',
      message: i.message,
    })),
  );
}
