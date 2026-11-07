import type { Env } from './env.js';
import { parseDuration } from '../lib/duration.js';
import type { FeatureFlags } from '@csense/shared';

/** Everything `createApp` needs, resolved from the validated environment. */
export interface AppConfig {
  jsonBodyLimit: string;
  jwtAccessSecret: string;
  refreshTokenSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  bcryptCost: number;
  trustProxyHops: number;
  /** Minimum duration of every failed login response, in ms (0 disables). */
  failedLoginMinMs: number;
  features: FeatureFlags;
  rateLimit: {
    windowMs: number;
    max: number;
    authWindowMs: number;
    loginMaxPerAccountIp: number;
    loginMaxPerIp: number;
    /** Account-wide failures (all IPs) per window that raise an audit warning. Never blocks. */
    loginTargetedThreshold: number;
    refreshMaxPerIp: number;
  };
}

export function toAppConfig(env: Env): AppConfig {
  return {
    jsonBodyLimit: env.JSON_BODY_LIMIT,
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET,
    accessTtlSeconds: parseDuration(env.JWT_ACCESS_TTL),
    refreshTtlSeconds: parseDuration(env.JWT_REFRESH_TTL),
    bcryptCost: env.BCRYPT_COST,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    failedLoginMinMs: env.AUTH_FAILED_LOGIN_MIN_MS,
    features: {
      phishing: env.FEATURE_PHISHING,
      continuousReview: env.FEATURE_CONTINUOUS_REVIEW,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      authWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
      loginMaxPerAccountIp: env.AUTH_LOGIN_MAX_PER_ACCOUNT_IP,
      loginMaxPerIp: env.AUTH_LOGIN_MAX_PER_IP,
      loginTargetedThreshold: env.AUTH_LOGIN_TARGETED_THRESHOLD,
      refreshMaxPerIp: env.AUTH_REFRESH_MAX_PER_IP,
    },
  };
}
