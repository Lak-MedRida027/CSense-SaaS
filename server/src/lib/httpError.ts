import type { ErrorCode } from '@csense/shared';

export interface ValidationIssue {
  location: 'body' | 'params' | 'query';
  path: string;
  message: string;
}

/** Error carrying an HTTP status and a stable machine-readable code for the error envelope. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    /** Extra response headers, for example Retry-After. */
    public readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthenticated = (): HttpError =>
  new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');

export const invalidCredentials = (): HttpError =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

export const invalidRefreshToken = (): HttpError =>
  new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');

export const forbidden = (): HttpError =>
  new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');

export const notFoundError = (): HttpError => new HttpError(404, 'NOT_FOUND', 'Resource not found');

export const conflict = (message = 'Resource already exists'): HttpError =>
  new HttpError(409, 'CONFLICT', message);

export const validation = (issues: ValidationIssue[]): HttpError =>
  new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', { issues });

export const rateLimited = (): HttpError =>
  new HttpError(429, 'RATE_LIMITED', 'Too many requests, please try again later');

export const moduleLocked = (): HttpError =>
  new HttpError(403, 'MODULE_LOCKED', 'Complete the previous module to unlock this one');

export const finalTestLocked = (): HttpError =>
  new HttpError(403, 'FINAL_TEST_LOCKED', 'Pass every module to unlock the final assessment');

export const contentIncomplete = (message = 'Finish the module content first'): HttpError =>
  new HttpError(409, 'CONTENT_INCOMPLETE', message);

export const alreadyPassed = (): HttpError =>
  new HttpError(409, 'ALREADY_PASSED', 'This assessment has already been passed');

export const sessionClosed = (): HttpError =>
  new HttpError(409, 'SESSION_CLOSED', 'This session is no longer open');

export const sessionExpired = (): HttpError =>
  new HttpError(409, 'SESSION_EXPIRED', 'This session has expired');

export const assessmentCooldown = (retryAt: Date, now: Date): HttpError =>
  new HttpError(
    409,
    'ASSESSMENT_COOLDOWN',
    'Too many unsuccessful attempts. Try again later.',
    { retryAt: retryAt.toISOString() },
    { 'Retry-After': String(Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))) },
  );
