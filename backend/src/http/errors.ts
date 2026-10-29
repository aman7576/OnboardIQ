// One error type for every deliberate HTTP failure; the handler turns it into a JSON body.
export interface FieldIssue {
  field: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldIssue[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, fields?: FieldIssue[]) =>
  new HttpError(400, 'VALIDATION_ERROR', message, fields);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (code: string, message: string) => new HttpError(403, code, message);
// Object-level denials use 404 so a caller cannot tell "not yours" from "does not exist".
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooManyRequests = (message: string) =>
  new HttpError(429, 'TOO_MANY_REQUESTS', message);
export const unprocessable = (code: string, message: string, fields?: FieldIssue[]) =>
  new HttpError(422, code, message, fields);
