import type { Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { ROLES, type AuthContext, type Role } from '@csense/shared';

/** Required on every route. There is no default: a missing `access` stops the server starting. */
export type Access =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'role'; roles: readonly [Role, ...Role[]] };

export const PUBLIC: Access = { kind: 'public' };
export const AUTHENTICATED: Access = { kind: 'authenticated' };
export const ADMIN_ONLY: Access = { kind: 'role', roles: ['administrator'] };
export const EMPLOYEE_ONLY: Access = { kind: 'role', roles: ['employee'] };

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type LimiterName = 'login' | 'refresh';

export interface RouteContext<B = unknown, P = unknown, Q = unknown> {
  body: B;
  params: P;
  query: Q;
  /** Null only on `public` routes. Use `requireAuth(ctx)` on routes that need a caller. */
  auth: AuthContext | null;
  requestId: string;
  ip: string;
  userAgent?: string | undefined;
}

export interface RouteDef<B = unknown, P = unknown, Q = unknown> {
  method: HttpMethod;
  /** Relative to /api/v1. */
  path: string;
  access: Access;
  schemas?: { body?: ZodType<B>; params?: ZodType<P>; query?: ZodType<Q> };
  limiter?: LimiterName;
  /** Return a value to send it as 200 JSON, or write to `res` and return nothing. */
  handler: (ctx: RouteContext<B, P, Q>, req: Request, res: Response) => unknown;
}

/** Infers B/P/Q from the schemas, then erases them so heterogeneous defs fit in one array. */
export function defineRoute<B = unknown, P = unknown, Q = unknown>(
  def: RouteDef<B, P, Q>,
): RouteDef {
  return def as unknown as RouteDef;
}

const accessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }).strict(),
  z.object({ kind: z.literal('authenticated') }).strict(),
  z.object({ kind: z.literal('role'), roles: z.array(z.enum(ROLES)).min(1) }).strict(),
]);

const routeShapeSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: z.string().startsWith('/'),
  access: accessSchema,
  limiter: z.enum(['login', 'refresh']).optional(),
  handler: z.custom((v) => typeof v === 'function', 'must be a function'),
});

/** Startup check. Throws (so the server refuses to start) on anything unannotated or ambiguous. */
export function assertRouteDefs(defs: readonly RouteDef[]): void {
  const seen = new Set<string>();
  defs.forEach((def, index) => {
    const label = `route #${String(index)} (${def.method} ${def.path})`;
    const parsed = routeShapeSchema.safeParse(def);
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => i.path.join('.') || 'route').join(', ');
      throw new Error(`Invalid ${label}: ${why}`);
    }
    const key = `${def.method} ${def.path}`;
    if (seen.has(key)) throw new Error(`Duplicate ${label}`);
    seen.add(key);
  });
}

export function requireAuth(ctx: { auth: AuthContext | null }): AuthContext {
  if (ctx.auth === null) {
    // Programming error: an authenticated route was declared as public.
    throw new Error('requireAuth called on a route without an authenticated caller');
  }
  return ctx.auth;
}
