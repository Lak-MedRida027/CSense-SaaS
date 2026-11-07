import type { RequestHandler } from 'express';
import { match, type MatchFunction } from 'path-to-regexp';
import type { AuthContext } from '@csense/shared';
import { forbidden, notFoundError, unauthenticated } from '../lib/httpError.js';
import type { RouteDef } from './routeRegistry.js';

/**
 * Matcher options shared with the Express router (which uses the same path-to-regexp options):
 * case-sensitive, trailing slash tolerated, params decoded. Keep the two in sync (ADR 0005).
 */
export const MATCH_OPTIONS = {
  sensitive: true,
  end: true,
  trailing: true,
  decode: decodeURIComponent,
} as const;

export const ROUTER_OPTIONS = { caseSensitive: true, strict: false, mergeParams: false } as const;

export interface GateLocals {
  routeDef?: RouteDef;
  auth?: AuthContext | null;
}

interface Compiled {
  def: RouteDef;
  matcher: MatchFunction<Record<string, string | string[]>>;
}

export type Authenticate = (authorizationHeader: string | undefined) => Promise<AuthContext | null>;

/**
 * The single policy enforcement point. Deny by default:
 * - no registry match -> 404 (so a handler attached any other way is unreachable)
 * - match -> enforce `access`: 401 without a valid session, 403 for the wrong role.
 */
export function accessGate(defs: readonly RouteDef[], authenticate: Authenticate): RequestHandler {
  const compiled: Compiled[] = defs.map((def) => ({
    def,
    matcher: match(def.path, MATCH_OPTIONS),
  }));

  return (req, res, next) => {
    void (async () => {
      try {
        const method = req.method.toLowerCase();
        // Express answers HEAD with the GET handler, so the gate treats HEAD as GET.
        const effective = method === 'head' ? 'get' : method;
        let found: RouteDef | undefined;
        for (const { def, matcher } of compiled) {
          if (def.method !== effective) continue;
          let matched = false;
          try {
            matched = matcher(req.path) !== false;
          } catch {
            matched = false; // undecodable path: treat as no match
          }
          if (matched) {
            found = def;
            break;
          }
        }
        if (!found) {
          next(notFoundError());
          return;
        }

        const locals = res.locals as GateLocals;
        locals.routeDef = found;
        locals.auth = null;
        if (found.access.kind !== 'public') {
          const auth = await authenticate(req.headers.authorization);
          if (auth === null) {
            next(unauthenticated());
            return;
          }
          if (found.access.kind === 'role' && !found.access.roles.includes(auth.role)) {
            next(forbidden());
            return;
          }
          locals.auth = auth;
        }
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
}
