import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import type { ApiError } from '@csense/shared';
import { HttpError } from '../lib/httpError.js';

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Uniform error envelope. Never leaks stack traces or internal messages to clients. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (err instanceof HttpError) {
      ({ status, code, message } = err);
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

    const body: ApiError = { error: { code, message } };
    res.status(status).json(body);
  };
}
