# ADR 0005: Central authorization gate, input validation and append-only audit log

- Status: Accepted (Phase 2 plan approved 2026-11-06)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)

## Context
CLAUDE.md requires RBAC on every protected route with deny-by-default, server-side zod validation on
every input, and an immutable audit-log entry for every risk escalation. "Deny by default" is easy to
claim and hard to keep: with plain Express, a route added with `router.get(...)` and no auth
middleware is public. We want the property enforced by code and proved by tests, not by review.
Express 5 is in use (`req.query` is a read-only getter; async errors propagate natively).

## Decision

### Route registry and a single policy enforcement point
- Every API route is a declarative `RouteDef` (`method`, `path`, `access`, optional zod `schemas`
  for `body`/`params`/`query`, optional limiter, `handler`). `access` is a required discriminated
  union: `{ kind: 'public' }`, `{ kind: 'authenticated' }`, or `{ kind: 'role', roles: [Role, ...] }`.
- `buildApiRouter(defs)` validates the definitions at startup with zod (missing or unknown `access`,
  empty `roles`, duplicate method+path all throw, so the server refuses to start) and is the only code
  that registers handlers.
- The first middleware on `/api/v1` is the **access gate**. It matches the request (method + path,
  case-sensitive, using the same matcher options as the router) against the registry:
  no match -> 404; match -> enforce that definition's `access` (401 without a valid token, 403 with
  the wrong role) before any route-level code runs. A handler attached to the router by any other
  means is unreachable (404), even with an administrator token. Role matching is exact: an
  administrator is not implicitly an employee.
- A route-inventory test snapshots every `(method, path, access)` triple, so adding or changing a
  route's authorization shows up as a reviewed test diff, and sweep tests hit every non-public route
  without a token (401) and every admin route with an employee token (403).

### Validation
- The registry wraps each handler with a zod validator. Schemas not supplied default to strict
  empty objects, so unexpected query parameters or body fields are rejected (400), not ignored.
  Parsed values are handed to the handler as a typed `ctx` (never written back to `req.query`).
- Request schemas that the desktop also needs live in `@csense/shared` (`zod` becomes a dependency of
  shared, as anticipated by ADR 0001). Strings have maximum lengths; ids are 24-hex ObjectIds; the
  query parser is `simple`; Mongoose `sanitizeFilter` is enabled as a second layer against operator
  injection.

### Error model
- One envelope `{ error: { code, message, details? } }` with a fixed code list in `@csense/shared`.
  `details` is only used for `VALIDATION_ERROR` and contains location, path and message, never the
  submitted value. Authentication failures use one message per endpoint regardless of cause.
  No stack traces or internal messages reach the client.

### Append-only audit log
- `AuditLog` model (`auditlogs`): `createdAt` only, `strict: 'throw'`, action from a closed list in
  `@csense/shared`. Mongoose middleware rejects every update, replace and delete path
  (`save` on an existing document, `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`,
  `findOneAndReplace`, `deleteOne` (query and document), `deleteMany`, `findOneAndDelete`,
  `bulkWrite`) with an `AuditLogImmutableError`. Inserts (`create`, `insertMany`) are the only writes.
- Writes are awaited; if an audit write fails the request fails (fail closed).
- The audit service strips or rejects metadata keys that look like secrets (password, token, hash,
  secret) and never stores the email typed for an unknown account.

## Decisions (approved 2026-11-06, Phase 2 plan section 18)
D-1 to D-15 were approved as the recommended defaults (full list in ADR 0004). The ones that shape
this ADR:
- D-5 Per-request DB check of user active, role and session inside the access gate.
- D-6 Deactivated accounts get the same generic 401 as bad credentials.
- D-7 Administrators may create administrators via `POST /admin/users` (warning-severity audit).
- D-10 Rate limits: global per IP (health exempt), login failures per account and per IP, refresh
  failures per IP; `TRUST_PROXY_HOPS=0`.
- D-11 Audit stores IP, user agent and request id; never the typed email of an unknown account.
- D-12 Logout is a `public` registry route authenticated by the refresh token in the body.
- D-14 `GET /config/features` is registered with `authenticated` access.
- D-15 `zod` is a dependency of `@csense/shared` for the shared request schemas.

## Consequences
- Positive: authorization is data, visible in one table and enforced in one place; tests prove that
  unregistered handlers are unreachable; input drift is caught; audit integrity holds for all
  application code paths.
- Negative: the gate and the router match paths twice (negligible cost) and must use identical
  matching options (covered by path-normalisation tests). Model-level immutability does not stop
  the raw driver or a database user with write rights: production should give the application's
  MongoDB user insert/find only on `auditlogs` (Phase 10), and tamper evidence (hash chaining) is a
  Phase 4 decision. Without replica-set transactions, a business write and its audit entry are not
  atomic; the audit write happens first for escalations so a failure aborts the action. For
  `user.created` the user is inserted first and deleted again if the audit write fails.
- Update (Phase 4): tamper evidence is implemented as a keyed hash chain (ADR 0012), and for escalations the "audit first" rule is replaced by an outbox with idempotent audit writes (ADR 0011).
