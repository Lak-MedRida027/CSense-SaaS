/** Stable machine-readable error codes used in the API error envelope. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'BAD_REQUEST',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'INVALID_REFRESH_TOKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
