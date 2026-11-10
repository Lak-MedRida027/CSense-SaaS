import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { emailSchema } from '@csense/shared';
import type { AppConfig } from '../config/appConfig.js';
import { getRequestId } from '../http/requestId.js';
import { rateLimited } from '../lib/httpError.js';
import { audit } from '../features/audit/audit.service.js';
import { User } from '../models/index.js';

export interface Limiters {
  global: RequestHandler;
  login: RequestHandler[];
  refresh: RequestHandler[];
  /** Per-employee throttle on starting quiz / final-test sessions (runs after the access gate). */
  sessionStart: RequestHandler[];
  /** Per-employee throttle on offline-release reports. */
  gateReport: RequestHandler[];
  /** Feeds the account-wide counter; called by the login service when it decides a failure. */
  onCredentialsFailure: (email: string) => void;
}

export interface LimiterOptions {
  /** Called when a best-effort background audit write fails (the response was already sent). */
  onBackgroundError?: (err: unknown) => void;
  /** Injectable time source (ms since epoch) so window logic is testable without waiting. */
  now?: () => number;
}

const clientIp = (req: Request): string => ipKeyGenerator(req.ip ?? '0.0.0.0');

function retryAfterSeconds(req: Request): number {
  const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  return reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : 1;
}

/** Normalised email from a raw (unvalidated) body, or null when it is not a usable email. */
function bodyEmail(req: Request): string | null {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return null;
  const email = (body as { email?: unknown }).email;
  const parsed = emailSchema.safeParse(email);
  return parsed.success ? parsed.data : null;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window counters with lazy expiry. In memory, single instance (like the other limiters). */
class WindowCounter {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly SWEEP_AT = 10_000;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  private live(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  /** Current count and the end of the window, without counting. */
  peek(key: string): Bucket | undefined {
    return this.live(key);
  }

  /** Adds `delta` (may be negative) and returns the new bucket. */
  add(key: string, delta: number): Bucket {
    const existing = this.live(key);
    if (existing) {
      existing.count = Math.max(0, existing.count + delta);
      return existing;
    }
    if (this.buckets.size >= WindowCounter.SWEEP_AT) this.sweep();
    const created = { count: Math.max(0, delta), resetAt: this.now() + this.windowMs };
    this.buckets.set(key, created);
    return created;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}

export function createLimiters(
  cfg: AppConfig['rateLimit'],
  options: LimiterOptions = {},
): Limiters {
  const now = options.now ?? Date.now;
  // With TRUST_PROXY_HOPS=0 a spoofed X-Forwarded-For is ignored, so that validation warning is noise.
  const common = {
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  };

  const respond =
    (
      onLimit?: (req: Request, res: Response) => Promise<void>,
      retryAfter: (req: Request) => number = retryAfterSeconds,
    ): RequestHandler =>
    (req, res, next) => {
      void (async () => {
        try {
          await onLimit?.(req, res);
        } catch (err) {
          next(err);
          return;
        }
        res.setHeader('Retry-After', String(retryAfter(req)));
        next(rateLimited());
      })();
    };

  const loginAudit = async (req: Request, res: Response): Promise<void> => {
    await audit.record({
      action: 'auth.login.rate_limited',
      outcome: 'failure',
      severity: 'warning',
      ctx: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: getRequestId(res),
      },
    });
  };

  const global = rateLimit({
    ...common,
    windowMs: cfg.windowMs,
    limit: cfg.max,
    keyGenerator: clientIp,
    skip: (req) => req.method === 'GET' && (req.path === '/health' || req.path === '/health/ready'),
    handler: respond(),
  });

  // Runs FIRST. A request it rejects never reaches the account-level guard below, so an attacker
  // that is already blocked cannot spend anybody's account budget (P2-M1). It counts every
  // non-successful request from the IP, including malformed bodies.
  const loginPerIp = rateLimit({
    ...common,
    windowMs: cfg.authWindowMs,
    limit: cfg.loginMaxPerIp,
    skipSuccessfulRequests: true,
    keyGenerator: clientIp,
    handler: respond(loginAudit),
  });

  // Hard limit keyed by (normalised email, IP): one host can exhaust only its own budget for an
  // account, never the budget the real user has from another address (P2-M1).
  const hard = new WindowCounter(cfg.authWindowMs, now);
  // Account-wide signal across all IPs. It never blocks; it raises one audit warning per window.
  const wide = new WindowCounter(cfg.authWindowMs, now);

  const flagTargeted = async (email: string): Promise<void> => {
    const user = await User.findOne({ email }).select('_id').lean();
    await audit.record({
      action: 'auth.login.account_targeted',
      outcome: 'failure',
      severity: 'warning',
      target: user ? { type: 'user', id: user._id } : null,
      metadata: { failures: cfg.loginTargetedThreshold, windowMs: cfg.authWindowMs },
    });
  };

  const accountHardRetry = (req: Request): number => {
    const email = bodyEmail(req);
    const bucket = email === null ? undefined : hard.peek(`${email}\u0000${clientIp(req)}`);
    return bucket ? Math.max(1, Math.ceil((bucket.resetAt - now()) / 1000)) : 1;
  };
  const accountBlocked = respond(loginAudit, accountHardRetry);

  const loginPerAccount: RequestHandler = (req, res, next) => {
    // An unusable email cannot be attributed to an account; validation will answer 400 and nothing
    // is counted for any account.
    const email = bodyEmail(req);
    if (email === null) {
      next();
      return;
    }
    const key = `${email}\u0000${clientIp(req)}`;
    const current = hard.peek(key);
    if (current && current.count >= cfg.loginMaxPerAccountIp) {
      accountBlocked(req, res, next);
      return;
    }
    // Reserve the attempt up front so concurrent guesses cannot all slip under the limit...
    hard.add(key, 1);
    res.once('finish', () => {
      // ...then give it back unless the request ended as a credentials failure. Validation errors,
      // successes and server errors do not count against the account.
      if (res.statusCode !== 401) hard.add(key, -1);
    });
    next();
  };

  const refreshPerIp = rateLimit({
    ...common,
    windowMs: cfg.authWindowMs,
    limit: cfg.refreshMaxPerIp,
    skipSuccessfulRequests: true,
    keyGenerator: clientIp,
    handler: respond(),
  });

  // Fed by the login service at the moment it decides a credentials failure, not on `finish`, so a
  // client that drops the connection cannot hide guesses from the account-wide signal (P2-L7).
  // The warning is written in the background and is invisible to the client.
  const onCredentialsFailure = (email: string): void => {
    const total = wide.add(email, 1);
    if (total.count === cfg.loginTargetedThreshold) {
      flagTargeted(email).catch((err: unknown) => {
        options.onBackgroundError?.(err);
      });
    }
  };

  // Keyed by the authenticated employee, not the IP: it bounds the append-only attempt history one
  // account can create, wherever the requests come from. The access gate has already set the caller.
  const sessionStart = rateLimit({
    ...common,
    windowMs: cfg.sessionStartWindowMs,
    limit: cfg.sessionStartMax,
    // Every request counts and nothing is refunded afterwards. A refund based on how the response
    // ends can be forced by the client (abort the connection, send a malformed body), which would
    // let one account start sessions without limit.
    keyGenerator: (_req, res) =>
      `user:${(res.locals as { auth?: { userId?: string } | null }).auth?.userId ?? 'anonymous'}`,
    handler: respond(),
  });

  const gateReport = rateLimit({
    ...common,
    windowMs: cfg.gateReportWindowMs,
    limit: cfg.gateReportMax,
    keyGenerator: (_req, res) =>
      `user:${(res.locals as { auth?: { userId?: string } | null }).auth?.userId ?? 'anonymous'}`,
    handler: respond(),
  });

  return {
    global,
    login: [loginPerIp, loginPerAccount],
    refresh: [refreshPerIp],
    sessionStart: [sessionStart],
    gateReport: [gateReport],
    onCredentialsFailure,
  };
}
