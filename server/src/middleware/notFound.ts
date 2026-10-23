import type { RequestHandler } from 'express';
import type { ApiError } from '@csense/shared';

/** Deny by default: anything not explicitly routed is a 404. */
export const notFound: RequestHandler = (_req, res) => {
  const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
  res.status(404).json(body);
};
