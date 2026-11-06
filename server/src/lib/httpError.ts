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
