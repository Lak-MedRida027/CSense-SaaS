import type { z } from 'zod';
import type { Role } from '../constants/roles.js';
import type { loginRequestSchema } from '../schemas/auth.js';
import type { AdministratorDTO, EmployeeDTO } from './user.js';

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export interface TokenResponse {
  tokenType: 'Bearer';
  accessToken: string;
  /** Seconds. */
  accessTokenExpiresIn: number;
  refreshToken: string;
  /** ISO 8601. Absolute; rotation does not extend it. */
  refreshTokenExpiresAt: string;
}

export interface LoginResponse extends TokenResponse {
  user: EmployeeDTO | AdministratorDTO;
}

/** Exactly the claims carried by an access token. */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  /** Employees only: the latest gate run is restricted and not yet restored (ADR 0015). */
  accessRestricted: boolean;
}
