import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { ApiError, ErrorCode } from '@csense/shared';
import { HttpError, type ValidationIssue } from '../lib/httpError.js';

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Uniform error envelope. Never leaks stack traces or internal messages to clients. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (err instanceof HttpError) {
      ({ status, code, message, details } = err);
      if (status === 401 && code === 'UNAUTHENTICATED') {
        res.setHeader('WWW-Authenticate', 'Bearer');
      }
    } else if (err instanceof ZodError) {
      // Fallback: schemas parsed outside the registry validator. Never echo input values.
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      const issues: ValidationIssue[] = err.issues.map((i) => ({
        location: 'body',
        path: i.path.join('.'),
        message: i.message,
      }));
      details = { issues };
    } else if (typeof err === 'object' && err !== null) {
      const { type, status: bpStatus } = err as BodyParserError;
      if (type === 'entity.too.large') {
        status = 413;
        code = 'PAYLOAD_TOO_LARGE';
        message = 'Request body too large';
      } else if (type === 'entity.parse.failed') {
        status = 400;
        code = 'INVALID_JSON';
        message = 'Malformed JSON body';
      } else if (typeof bpStatus === 'number' && bpStatus >= 400 && bpStatus < 500) {
        status = bpStatus;
        code = 'BAD_REQUEST';
        message = 'Bad request';
      }
    }

    if (status >= 500) {
      logger.error({ err }, 'Unhandled error');
    }

    const body: ApiError = {
      error: { code, message, ...(details === undefined ? {} : { details }) },
    };
    res.status(status).json(body);
  };
}
