/** Password policy and token constants shared by the API and the desktop client (ADR 0004). */
export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt silently truncates beyond 72 bytes, so the limit is expressed in UTF-8 bytes. */
export const PASSWORD_MAX_BYTES = 72;
/** Login accepts longer strings so that over-long attempts get the generic 401, not a hint. */
export const LOGIN_PASSWORD_MAX_LENGTH = 1024;
export const BCRYPT_MIN_COST = 12;
export const TOKEN_TYPE = 'Bearer';
export const ACCESS_TOKEN_ISSUER = 'csense-api';
export const ACCESS_TOKEN_AUDIENCE = 'csense-desktop';
export const REFRESH_TOKEN_MAX_LENGTH = 200;
