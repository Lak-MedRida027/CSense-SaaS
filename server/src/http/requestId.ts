import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

/** Server-generated request id; an incoming X-Request-Id header is never trusted. */
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export function getRequestId(res: Response): string {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : 'unknown';
}
