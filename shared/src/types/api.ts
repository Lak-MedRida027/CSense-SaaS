import type { ErrorCode } from '../constants/errors.js';

/** Uniform error envelope returned by every API error response. */
export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ready' | 'unavailable';
}
