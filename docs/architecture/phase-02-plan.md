# CSense Phase 2 plan: authentication and the server security baseline

Status: **Approved 2026-11-06** (D-1 to D-15 approved as recommended; D-16 dropped). Branch:
`phase-02-auth-security`. ADRs: 0004, 0005 (Accepted). Handoff to the backend-engineer.

No feature code was written. I wrote two ADRs and updated the auth section of the API contract (paths at the end).

## 0. Sources and caveats
- **Read:**
  - CLAUDE.md, docs/api/contract.md, docs/architecture/data-model.md, ADR 0001–0003, docs/BUILD_PLAYBOOK.md (Phase 2), docs/design/screens.md
  - both UML PNGs
  - server/src: app.ts, index.ts, config/env.ts, db/connect.ts, lib/httpError.ts, lib/logger.ts, middleware/*, models/*, features/health
  - server/test/*, server/package.json, shared/src/*, .env.example, CI workflow, eslint config
- **Could not read** `docs/CSense_Client_Needs.docx` (binary, no shell available to me). Requirement mapping uses CLAUDE.md, the contract, the data model and the UML. FR numbers for auth are **unverified**.
- **Phase 0 decision log is not in the repo.** Only U1, U2, U3, U5, U7–U10, U12, U15 and U20 are referenced in code or docs. I reuse U1 (User discriminator on `role`), U15 (gate pre-auth, Phase 5) and U20 (bootstrap admin with `createdBy: null`). The Phase 1 decisions I reuse are D18 (password reset via administrator) and the generic login error text "Email or password is incorrect." from screens.md.
  - Recommendation: commit the U-decision table to `docs/architecture/decisions.md`.
- **Branching:** the current branch is `phase-01-design-system` and `.claude/launch.json` is untracked. Phase 2 should start on `phase-02-auth-security`, branched from `main` after the Phase 1 PR merges.

## 1. Scope and requirement map
| Item | Requirement source |
|---|---|
| Login, refresh, logout, me | UC "Authenticate" (included by Security Gate and Admin Dashboard); Class UML `User.authenticate(pwd)`, `generateTokens()`; CLAUDE.md token baseline |
| bcrypt ≥ 12, hash never exposed | Class UML `User.hashPassword()`; CLAUDE.md |
| `POST /admin/users` | UC "Manage Users"; Class UML `Administrator.createUser(u): User` and the «creates» dependency; CLAUDE.md "no self-registration" |
| Bootstrap admin CLI | U20; data-model `createdBy` null only for the bootstrap admin |
| RBAC deny-by-default gate | CLAUDE.md security baseline; contract "anything not listed returns 404" |
| helmet, rate limit, zod everywhere, error model | CLAUDE.md security baseline; ADR 0001 |
| Append-only AuditLog | CLAUDE.md "every risk escalation writes an immutable audit log"; data-model FR12/FR13 and ISO 27001; contract "System-triggered use cases" |
| AuthSession model | data-model "Planned additions: refresh tokens (Phase 2)" |
| `GET /config/features` | Contract lists it as Phase 2 (comes from the feature-flag open question) |

**Flagged as hardening with no explicit requirement** (derived from the baseline; cheap, recommended):
- request-id header plus audit correlation
- `Cache-Control: no-store`
- Mongoose `sanitizeFilter`
- rehash-on-login when the cost is raised
- route-inventory snapshot test
- `TRUST_PROXY_HOPS`

**Out of scope (deferred):**
- list/get/patch/deactivate/reactivate users, admin password reset (D18), forced password change: Phase 7
- audit-log read API and hash-chaining: Phase 4
- desktop token storage: Phase 5
- shared rate-limit store and the DB role that restricts `auditlogs`: Phase 10

## 2. Request pipeline (target `createApp`)
`createApp` becomes **async**: `createApp(opts): Promise<Express>`. It precomputes the dummy bcrypt hash at the configured cost before returning.

Order:
1. `app.disable('x-powered-by')`, `app.set('query parser','simple')`, `app.set('trust proxy', cfg.trustProxyHops)` (only if > 0)
2. `helmet()` (as today)
3. request id: `randomUUID()`, set on `X-Request-Id`; incoming header not trusted; passed as `pino-http` `genReqId`
4. `pino-http`, with added redactions `*.accessToken`, `*.currentTokenHash`, `*.previousTokenHashes`, `req.body.password`
5. `express.json({ limit })`
6. On `/api/v1`, `Cache-Control: no-store` for every response
7. Global rate limiter (per IP; skips `GET /health*`)
8. `buildApiRouter(allRoutes, deps)`, which contains:
   - a. **access gate**: match the registry. No match → 404; otherwise enforce `access` (401/403).
   - b. per-route limiter, if declared (`login`, `refresh`)
   - c. zod validation of body/params/query, producing a typed `ctx`
   - d. handler
9. `notFound`, then `errorHandler` (as today, plus `details` passthrough and a `ZodError` fallback mapped to 400)

`AppOptions` becomes `{ logger, config: AppConfig, isReady?, clock?: () => Date, routes?: RouteDef[] }`.
- `AppConfig` is produced by `toAppConfig(env)`.
- Tests build `AppConfig` directly through a helper with **randomly generated secrets** (no hard-coded secrets, and CI needs no new env vars).
- `clock` is injectable so expiry tests do not need fake timers on the Mongo driver.

## 3. Data model

### 3.1 User (change)
Existing `server/src/models/User.ts` with U1 discriminators. Changes:
- Add a base-schema `pre('validate')` hook, registered **before** the `discriminator()` calls so both discriminators inherit it: if `isNew && createdBy == null && !this.$locals.bootstrap`, invalidate `createdBy` as required. This enforces U20 at model level.
- No new fields. `lastLoginAt` and `mustChangePassword` are deferred (Decision D-8).
- Update `models.indexes.test.ts` fixtures to pass `createdBy`.

### 3.2 AuthSession (new, `authsessions`)
Each session is one refresh-token family.

| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| currentTokenHash | String (hex HMAC-SHA256) | required, `select:false` |
| previousTokenHashes | [String] | default `[]`, `select:false`, capped at the last 50 with `$push $slice` |
| expiresAt | Date | required; login + `JWT_REFRESH_TTL` (absolute, never extended) |
| rotatedAt | Date \| null | |
| rotationCount | int | default 0 |
| revokedAt | Date \| null | default null |
| revokedReason | `logout` \| `reuse_detected` \| `user_inactive` \| `admin_revoked` \| null | |
| ip, userAgent | String | captured at login; max 64 / 256 |

- Uses timestamps and `strict:'throw'`. `toJSON` never emits the hashes.
- Indexes: `{userId:1, revokedAt:1}`; TTL on `{expiresAt:1}` with `expireAfterSeconds: 2592000` (30 days after expiry, kept for investigations).

### 3.3 AuditLog (new, `auditlogs`, append-only)
| Field | Type | Rules |
|---|---|---|
| action | enum `AUDIT_ACTIONS` (shared) | required |
| outcome | `success` \| `failure` | required |
| severity | `info` \| `warning` \| `critical` | default `info` |
| actorId | ObjectId \| null | null when anonymous or system |
| actorRole | Role \| null | |
| targetType | `user` \| `session` \| null | |
| targetId | ObjectId \| null | |
| ip, userAgent, requestId | String \| null | max 64 / 256 / 64 |
| metadata | Mixed | default `{}`; validator: JSON ≤ 2 KB |
| createdAt | Date | `timestamps: { createdAt: true, updatedAt: false }` |

- Indexes: `{createdAt:-1}`, `{actorId:1, createdAt:-1}`, `{targetId:1, createdAt:-1}`, `{action:1, createdAt:-1}`.
- **Immutability:** pre-hooks throw `AuditLogImmutableError` (code `AUDIT_LOG_IMMUTABLE`) on:
  - `save` when `!isNew`
  - `updateOne`, `updateMany`, `findOneAndUpdate` (this also covers `findByIdAndUpdate`)
  - `replaceOne`, `findOneAndReplace`
  - `deleteOne` (query and document)
  - `deleteMany`, `findOneAndDelete` (also covers `findByIdAndDelete`)
  - `bulkWrite` (blocked entirely)
- Allowed writes: `create`, `insertMany`.
- `test/setup.ts` cleans up through `mongoose.connection.collections[*].deleteMany`, a driver-level call that bypasses schema middleware. So cleanup keeps working; the implementer should confirm this.
- Phase 2 `AUDIT_ACTIONS`:
  - `auth.login.succeeded`
  - `auth.login.failed` (metadata `reason`: `bad_credentials` | `unknown_account` | `inactive`)
  - `auth.login.rate_limited`
  - `auth.refresh.reuse_detected` (critical)
  - `auth.refresh.denied` (reason `user_inactive`)
  - `auth.logout`
  - `user.created` (warning when the role is administrator)
  - `admin.bootstrapped` (critical)
- Phase 4 appends risk and escalation actions.

### 3.4 Global Mongoose settings
Move `strictQuery` from `db/connect.ts` into a new `db/mongooseSettings.ts`, add `sanitizeFilter: true`, and import it from `models/index.ts` so tests get the same settings.

## 4. Tokens (full rationale in ADR 0004)
**Access token** (`jose` `SignJWT`, HS256, `typ: JWT`):
- Claims are exactly `{ sub, role, sid, iss:'csense-api', aud:'csense-desktop', iat, exp, jti }`. Nothing else: no email, name or hash.
- Verify with `jwtVerify(token, key, { algorithms:['HS256'], issuer, audience, currentDate: clock() })`, then re-validate the claims with zod: `sub` and `sid` are 24-hex, `role` ∈ ROLES.
- Bearer header regex `^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$`; tokens over 2 KB are rejected.
- **Per-request check:** `User.findById(sub).select('role isActive')` and `AuthSession.findById(sid).select('userId revokedAt expiresAt')`. The request is 401 if the user is missing or inactive, the role differs from the token, the session is revoked or expired, or `session.userId ≠ sub`.

**Refresh token**:
- Format: opaque `${sid}.${randomBytes(32).toString('base64url')}`.
- Stored as `HMAC-SHA256(REFRESH_TOKEN_SECRET, token)`; compared with `timingSafeEqual` when checking the previous-hash list.

**Flows:**
- **Login:** validate → find user `+passwordHash` → `verifyPassword` (dummy hash if the user is missing) → reject if inactive → create `AuthSession` → sign the access token → audit → 200.
  - If the user's hash rounds are below the configured cost, rehash and save.
- **Refresh:**
  1. Parse the `sid`.
  2. Atomically `findOneAndUpdate({_id:sid, currentTokenHash:h, revokedAt:null, expiresAt:{$gt:now}}, {$set:{currentTokenHash:h2, rotatedAt:now}, $inc:{rotationCount:1}, $push:{previousTokenHashes:{$each:[h], $slice:-50}}})`.
  3. If that matched nothing, load the session. If `h` is in `previousTokenHashes`, revoke (`reuse_detected`), write a critical audit entry and return 401. Otherwise return 401 and change nothing.
  4. If it matched, load the user. If inactive, revoke (`user_inactive`), audit, 401. Otherwise sign a new access token from the **DB role** and return 200 with the same `refreshTokenExpiresAt`.
- **Logout:**
  1. Parse the `sid`.
  2. If `h` matches the current or a previous hash, set `revokedAt` (`logout`) if not already set, and audit.
  3. Always return 204.
- **Me:** `ctx.auth.userId` → `toUserDTO`.

`revokeAllForUser(userId, reason)` is exposed now for Phase 7 deactivation.

## 5. Passwords
- `password.ts` is the only module that imports `bcrypt`. It provides:
  - `hashPassword(pw)`: asserts cost ≥ 12
  - `verifyPassword(pw, hash)`
  - `verifyAgainstDummy(pw)`
  - `needsRehash(hash)` via `getRounds`
  - `initDummyHash()`: a random 32-byte secret hashed at the configured cost, run at app start
- Login for an unknown email still performs exactly one bcrypt compare. Unknown, wrong-password and inactive all return the identical `401 INVALID_CREDENTIALS` "Email or password is incorrect." with identical headers.
- Password policy (shared constants):
  - min 12 characters, max 72 UTF-8 bytes (bcrypt truncation limit), no composition rules (D-9)
  - Login accepts strings of 1..1024 chars. Anything over 72 bytes still runs a dummy-cost compare and returns the generic 401, never a distinct error.
- No account lockout state: throttling is done by the rate limiters (§8).

## 6. RBAC deny-by-default (ADR 0005)
Shapes:
```ts
type Access = { kind: 'public' } | { kind: 'authenticated' } | { kind: 'role'; roles: readonly [Role, ...Role[]] };
interface RouteDef<B, P, Q> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; // relative to /api/v1
  access: Access; schemas?: { body?: ZodType<B>; params?: ZodType<P>; query?: ZodType<Q> };
  limiter?: 'login' | 'refresh';
  handler: (ctx: RouteContext<B, P, Q>, req: Request, res: Response) => unknown;
}
interface RouteContext<B, P, Q> { body: B; params: P; query: Q; auth: AuthContext | null; requestId: string; ip: string; userAgent?: string }
interface AuthContext { userId: string; role: Role; sessionId: string }
```
Helpers: `PUBLIC`, `AUTHENTICATED`, `ADMIN_ONLY`, `EMPLOYEE_ONLY`; `defineRoute()` for inference.

**Startup checks:** `assertRouteDefs` runs a zod check over all defs and throws on:
- missing or unknown `access`
- empty `roles`
- a path without a leading `/`
- duplicate method+path

**The gate:**
- Matches with `path-to-regexp` `match` (added as an explicit dependency, same major as Express 5), case-sensitive and non-strict. The router is created with the same `caseSensitive: true` option.
- Raw handlers attached outside the registry are unreachable.
- Role matching is exact.

**Proof by tests** (§15 B1–B6):
- startup rejection of unannotated defs
- a raw route returning 404 even with an admin token
- an inventory snapshot of every `(method, path, access)`
- sweep tests: every non-public route returns 401 without a token; every admin route returns 403 with an employee token
- path-normalisation bypass attempts

## 7. Validation and error model
- **`validate`** (inside the registry):
  - Missing schemas default to `z.object({}).strict()`. A body schema is applied only to methods that carry bodies; otherwise the body must be `undefined` or `{}`.
  - Output goes to `ctx`, never to `req.query` (it is read-only in Express 5).
  - `VALIDATION_ERROR` details: `{ issues: [{ location, path, message }] }` with no input values.
- **Shared zod schemas** (adds `zod` to `@csense/shared`):
  - `emailSchema`: trim, lowercase, max 254, `z.email()`
  - `newPasswordSchema`: 12 chars minimum, 72 bytes maximum
  - `loginPasswordSchema`: 1..1024
  - `objectIdSchema`
  - `loginRequestSchema` `{email, password}`, `refreshRequestSchema` and `logoutRequestSchema` `{refreshToken: string 1..200}`
  - `createUserRequestSchema` `{name 1..120, email, password, role, department? ≤120}`
  - All are `.strict()`.
- **Error codes:** a shared `ERROR_CODES` const in `shared/src/constants/errors.ts`; `ApiError.code` is typed `ErrorCode`. The table is in the updated contract. `HttpError` gains an optional `details` field and factories: `unauthenticated()`, `invalidCredentials()`, `invalidRefreshToken()`, `forbidden()`, `conflict()`, `validation(issues)`.
- 401 `UNAUTHENTICATED` sets `WWW-Authenticate: Bearer`. Mongo duplicate-key 11000 maps to 409 **only** inside `users.service`. Everything unknown stays a generic 500.

## 8. helmet, rate limits, other hardening
- **helmet:** unchanged defaults (already tested).
- **express-rate-limit ^8:** `standardHeaders: 'draft-8'`, `legacyHeaders: false`, handler emits the `RATE_LIMITED` envelope plus `Retry-After`.

| Limiter | Key | Counts | Default |
|---|---|---|---|
| global | IP | all requests (health exempt) | `RATE_LIMIT_MAX`=1000 per `RATE_LIMIT_WINDOW_MS`=900000 (D-10) |
| login-ip (runs first) | IP | failures only, including malformed bodies | `AUTH_LOGIN_MAX_PER_IP`=50 |
| login-account (hard, runs second) | (normalised email, IP) | only requests whose body passed validation and ended 401 | `AUTH_LOGIN_MAX_PER_ACCOUNT_IP`=10 per `AUTH_RATE_LIMIT_WINDOW_MS`=900000 |
| login-account-wide (signal only) | normalised email, all IPs | same failures; never blocks, writes `auth.login.account_targeted` (warning) once per window | `AUTH_LOGIN_TARGETED_THRESHOLD`=30 |
| refresh-ip | IP | failures only | `AUTH_REFRESH_MAX_PER_IP`=30 |

- Review fix P2-M1: a request rejected by the per-IP limiter never reaches an account counter, validation failures (400) are not counted, and the hard limit is per (email, IP) so one attacker address cannot lock a user out from another. Attempts are reserved on arrival (so a parallel burst cannot overshoot) and refunded unless the response is a 401.
- Review fix P2-L1: every failed login waits `AUTH_FAILED_LOGIN_MIN_MS` (default 1000, 0 disables) plus up to 10% jitter (max 100 ms).
- The login limiters treat unknown and known emails identically, so they cannot be used for enumeration. A trip of the login limiter writes `auth.login.rate_limited`.
- The store is in memory (single instance).
- No CORS middleware (ADR 0004).

## 9. Audit service
`audit.record({ action, outcome, severity?, actor?, target?, ctx?, metadata? })`:
- awaited; the request fails closed if the write fails
- strips metadata keys matching `/pass|token|secret|hash/i`
- never stores the email typed for an unknown account

For `user.created`: insert the user, then the audit entry. If the audit insert fails, delete the new user (compensation) and return 500. Transactions would need a replica set (see Risks).

## 10. Bootstrap first administrator (U20)
- `server/src/scripts/bootstrapAdmin.ts` exports `bootstrapAdmin(input, deps)`, which returns `'created' | 'skipped'`. A thin `main()` wrapper loads the server env plus its own zod schema:
  - `BOOTSTRAP_ADMIN_EMAIL`
  - `BOOTSTRAP_ADMIN_NAME`
  - `BOOTSTRAP_ADMIN_PASSWORD` (`newPasswordSchema`)
- These keys are not part of the server env, so the server never requires them.
- **Idempotent:** if any `administrator` exists, it logs "already bootstrapped" and exits 0 without touching anything (no password reset, no update).
- Otherwise it creates an Administrator with `createdBy: null` through `doc.$locals.bootstrap = true`, hashes at `BCRYPT_COST`, writes `admin.bootstrapped` (critical), and logs the email only.
- It never generates or prints a password. The docs tell operators to remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env` afterwards.
- Scripts: `"bootstrap:admin": "node dist/src/scripts/bootstrapAdmin.js"`, `"bootstrap:admin:dev": "tsx src/scripts/bootstrapAdmin.ts"`.
- There is no HTTP route for this.

## 11. Route list (Phase 2)
| Method | Path (`/api/v1`) | Access | Limiter | Body / response |
|---|---|---|---|---|
| GET | `/health` | public | global-exempt | `{status:'ok'}` (migrated into the registry) |
| GET | `/health/ready` | public | global-exempt | 200/503 |
| POST | `/auth/login` | public | login-account, login-ip | `{email,password}` → 200 token response + `user` |
| POST | `/auth/refresh` | public (refresh token in body) | refresh-ip | `{refreshToken}` → 200 token response |
| POST | `/auth/logout` | public (refresh token in body) | – | `{refreshToken}` → 204 always |
| GET | `/auth/me` | authenticated | – | → `UserDTO` |
| GET | `/config/features` | authenticated | – | → `{phishing, continuousReview}` |
| POST | `/admin/users` | role administrator | – | `{name,email,password,role,department?}` → 201 `UserDTO`, 409 on duplicate |

- Token response: `{ tokenType:'Bearer', accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt }`.
- Logout changes from "auth" to "refresh token" in the contract, so a client whose access token has expired can still log out (D-12).
- `POST /auth/register` stays 404.
- Deferred to Phase 7: `GET /admin/users`, `GET/PATCH /admin/users/:userId`, `deactivate`, `reactivate`, `password`.

## 12. Env schema (zod) and .env.example
Added to `envSchema` in `server/src/config/env.ts`:

| Key | Rule | Default |
|---|---|---|
| `JWT_ACCESS_SECRET` | string, min 32 | required |
| `REFRESH_TOKEN_SECRET` (renamed from `JWT_REFRESH_SECRET`, D-2) | string, min 32, `superRefine`: ≠ access secret | required |
| `JWT_ACCESS_TTL` | `^\d+[smhd]$`, 1m..30m | `15m` |
| `JWT_REFRESH_TTL` | same format, 1h..14d | `7d` |
| `BCRYPT_COST` | coerce int, **min 12**, max 15 | `12` |
| `RATE_LIMIT_WINDOW_MS` | int > 0 | `900000` |
| `RATE_LIMIT_MAX` | int > 0 | `1000` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | int > 0 | `900000` |
| `AUTH_LOGIN_MAX_PER_ACCOUNT_IP` | int > 0 | `10` |
| `AUTH_LOGIN_TARGETED_THRESHOLD` | int > 0 | `30` |
| `AUTH_FAILED_LOGIN_MIN_MS` | int 0..10000 | `1000` |
| `AUTH_LOGIN_MAX_PER_IP` | int > 0 | `50` |
| `AUTH_REFRESH_MAX_PER_IP` | int > 0 | `30` |
| `TRUST_PROXY_HOPS` | int 0..5 | `0` |

- `lib/duration.ts` handles `parseDuration` (no `ms` dependency). `config/appConfig.ts` provides `toAppConfig(env)`.
- **`.env.example`:**
  - Replace the commented Phase 2 block with live keys. Secrets stay **empty**, with the generation command `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
  - Add the commented `BOOTSTRAP_ADMIN_*` block.
  - Note that the app refuses to start without the secrets.
  - Update the header note that the file is synced with `env.ts`.

## 13. Dependencies
Run `npm view <pkg> version` before pinning; my version knowledge may be stale.

**server dependencies:**
- `jose` ^6
- `bcrypt` ^6
- `express-rate-limit` ^8
- `path-to-regexp` ^8 (already transitive via Express 5; declared to avoid a phantom dependency)

**server devDependencies:** `@types/bcrypt` (latest).

**shared dependencies:** `zod` ^4.6.7 (same range as the server).

Rejected: `jsonwebtoken` and `bcryptjs` (bcryptjs is the fallback; ADR 0004), `cookie-parser`, `cors`.

**Windows note:** bcrypt 6 ships prebuilt N-API binaries for win32-x64 and arm64, so there is no node-gyp step. If `npm ci` tries to compile, swap to `bcryptjs` in `password.ts` only and record the swap in ADR 0004. After adding deps, `npm audit --audit-level=high` must be clean.

## 14. Files to create or change
**shared/**
- `package.json` (+zod)
- `src/constants/auth.ts`: PASSWORD_MIN_LENGTH=12, PASSWORD_MAX_BYTES=72, BCRYPT_MIN_COST=12, TOKEN_TYPE
- `src/constants/audit.ts`: AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_SEVERITIES
- `src/constants/errors.ts`: ERROR_CODES, ErrorCode
- `src/schemas/common.ts`, `src/schemas/auth.ts`, `src/schemas/users.ts`
- `src/schemas/schemas.test.ts`
- `src/types/auth.ts`: LoginRequest, TokenResponse, LoginResponse, AccessTokenClaims, AuthContext
- `src/types/audit.ts`: AuditLogDTO, for Phase 4
- `src/types/api.ts`: `code: ErrorCode`
- `src/index.ts`: value exports for constants and schemas, type exports for types

**server/**
- `package.json`: deps and the bootstrap scripts
- `src/config/env.ts`, `src/config/appConfig.ts` (new)
- `src/lib/duration.ts`, `src/lib/httpError.ts` (details plus factories), `src/lib/logger.ts` (redactions)
- `src/db/mongooseSettings.ts` (new), `src/db/connect.ts`
- `src/http/routeRegistry.ts`, `src/http/accessGate.ts`, `src/http/validate.ts`, `src/http/requestId.ts`
- `src/middleware/rateLimit.ts`, `src/middleware/errorHandler.ts`
- `src/features/health/health.routes.ts` (converted to `RouteDef[]`)
- `src/features/auth/`: `auth.routes.ts`, `auth.service.ts`, `password.ts`, `tokens.ts`, `session.service.ts`
- `src/features/users/`: `users.routes.ts`, `users.service.ts`, `user.mapper.ts` (`toUserDTO`)
- `src/features/config/config.routes.ts`
- `src/features/audit/audit.service.ts`
- `src/routes.ts`: `allRoutes` aggregate
- `src/models/AuthSession.ts`, `src/models/AuditLog.ts`, `src/models/User.ts` (createdBy invariant), `src/models/index.ts`
- `src/scripts/bootstrapAdmin.ts`
- `src/app.ts` (async, config), `src/index.ts` (await createApp, toAppConfig)

**server/test/**
- `helpers/testConfig.ts`: random secrets, high limits, controllable clock
- `helpers/fixtures.ts`: a cost-12 hash computed once per file in `beforeAll`, `createEmployee`/`createAdmin` with `createdBy`, `login()`, `bearer()`
- New test files listed in §15. Update `health.test.ts`, `env.test.ts`, `models.indexes.test.ts`.

**docs/:**
- `architecture/data-model.md`: AuthSession, AuditLog, createdBy invariant (implementer)
- `.env.example` (implementer)
- `README` or `docs/ops` bootstrap instructions (implementer)
- Already done by me: ADR 0004, ADR 0005, `api/contract.md`

## 15. Test list
All tests run on mongodb-memory-server through `test/setup.ts`. Bcrypt runs at cost 12; there is no lower-cost test path.

**Unit**
- **env.test.ts**
  - E1: valid env with secrets parses and defaults apply (15m, 7d, 12, limits)
  - E2: a missing access or refresh secret throws, naming the key without echoing the value
  - E3: a secret shorter than 32 characters throws
  - E4: identical secrets throw
  - E5: `BCRYPT_COST` 10 or 11 throws, 16 throws, 12 and 13 are accepted
  - E6: malformed TTLs (`15`, `15x`, `-1m`) and out-of-bounds TTLs (access `2h`, refresh `60d`) throw
  - E7: non-positive limits and `TRUST_PROXY_HOPS` 9 throw
  - Update the existing defaults test so it supplies secrets.
- **duration.test.ts**
  - D1: s, m, h and d are parsed
  - D2: invalid input is rejected
- **password.test.ts**
  - P1: `getRounds(hash)` equals the configured cost and is ≥ 12
  - P2: `hashPassword` throws for cost 11
  - P3: verify returns true and false correctly
  - P4: `needsRehash` reports correctly
  - P5: a password over 72 bytes is verified as false without throwing
- **tokens.test.ts**
  - K1: the claim set equals exactly `{sub, role, sid, iss, aud, iat, exp, jti}`, alg is HS256, and there is no email, name or hash
  - K2: `exp - iat` equals the TTL
  - K3: verify rejects a wrong secret, `alg:none`, an HS512 re-sign, a tampered payload, the wrong iss or aud, an expired token (injected clock), a missing `sid`, and a role outside ROLES
  - K4: refresh token format is `^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$`; tokens are unique; the HMAC is deterministic and differs from the token; malformed tokens fail to parse
- **routeRegistry.test.ts**
  - R1: a def without `access` throws
  - R2: an unknown access kind throws
  - R3: empty `roles` throws
  - R4: duplicate method+path throws
  - R5: `createApp({routes:[badDef]})` rejects
- **shared schemas.test.ts**
  - Email is trimmed and lowercased.
  - Unknown keys are rejected.
  - A multibyte password over 72 bytes is rejected even when it is under 72 characters.
  - The role enum is enforced; `__proto__` payloads are rejected.

**Integration (supertest)**
- **auth.login.test.ts**
  - L1: employee happy path returns the full token-response shape and `Cache-Control: no-store`; there is no `passwordHash` anywhere; the AuthSession stores a hash and the raw refresh token string is absent from the DB
  - L2: admin login works
  - L3: email matching is case- and whitespace-insensitive
  - L4: **wrong password and unknown email** produce identical status, body and header set (ignoring date, request-id and ratelimit headers), and the bcrypt verify spy is called exactly once in each case
  - L5: an inactive user with the correct password gets the identical 401, no session is created, and the audit reason is `inactive`
  - L6: validation returns 400 `VALIDATION_ERROR` with paths and without the password value, for: missing fields, `{"password":{"$gt":""}}`, `{"email":{"$ne":null}}`, extra fields, and a non-JSON content type
  - L7: a 1025-character password returns 400; a 100-byte password returns the generic 401
  - L8: success and failure audit entries are written, and no audit doc contains the password or token strings
  - L9: a cost-12 hash is rehashed to 13 when the config cost is 13
  - L10: `POST /auth/register`, `/auth/signup` and `/users` all return 404
- **auth.me.test.ts** (authn)
  - A1: a valid token returns 200 with the DTO
  - A2: no header returns 401 `UNAUTHENTICATED` with `WWW-Authenticate: Bearer`
  - A3: malformed headers (`Token x`, `Bearer`, `Bearer a b`, a token over 2 KB) return 401
  - A4: a bad signature or `alg:none` returns 401
  - A5: an **expired** access token (clock advanced 16 min) returns 401 with a body identical to the invalid-token case
  - A6: 401 for a deleted user, a user deactivated after login, a session revoked by logout, and a forged role claim signed with the correct secret but different from the DB role
  - A7: an unknown query parameter returns 400
- **auth.refresh.test.ts**
  - F1: rotation succeeds: a new token is issued that differs from the old one, the new access token works, `currentTokenHash` changes, and `refreshTokenExpiresAt` is unchanged
  - F2: **reuse** of the old token returns 401 `INVALID_REFRESH_TOKEN` and revokes the session with `reuse_detected`; the newest refresh token then also returns 401, the family's access token returns 401, and a critical audit entry exists
  - F3: garbage or malformed tokens return 401 with no state change; a valid `sid` with a wrong secret returns 401 and does **not** revoke
  - F4: a token past the absolute expiry (clock +7d+1s) returns 401
  - F5: an inactive user returns 401, the session is revoked with `user_inactive`, and `auth.refresh.denied` is audited
  - F6: validation errors (missing, non-string, extra field) return 400
  - F7: two concurrent refreshes with the same token give exactly one 200 and one 401, and the family is revoked (documents D-4)
  - F8: an access JWT is rejected as a refresh token, and a refresh token is rejected as a bearer token
- **auth.logout.test.ts**
  - O1: logout returns 204; afterwards refresh returns 401, that session's access token returns 401, and `auth.logout` is audited
  - O2: an unknown token returns 204 with no state change
  - O3: a second logout returns 204
  - O4: other sessions of the same user are unaffected
  - O5: a missing body returns 400
- **admin.users.test.ts**
  - U1: admin creates an employee: 201, `createdBy` is the admin id, no hash in the response, stored hash rounds ≥ 12, and the new user can log in
  - U2: admin creates an administrator (D-7)
  - U3: a duplicate email in different case returns 409 `CONFLICT`
  - U4: 400 for: password under 12, password over 72 bytes, bad email, role `superadmin`, missing role, extra `isActive`/`createdBy`/`totalXP`/`passwordHash`/`role`-smuggled fields, and `__proto__`
  - U5: an **employee token returns 403** `FORBIDDEN` and no user is created; no token returns 401; an invalid token returns 401
  - U6: `user.created` is audited with actor and target and no password
  - U7: a failing audit write (mocked) returns 500 and no user remains
- **rbac.denyByDefault.test.ts**
  - B1: the route inventory snapshot equals the expected `(method, path, access)` table
  - B2: sweep: every non-public route returns 401 without a token (`:params` filled with a dummy ObjectId)
  - B3: sweep: every role-administrator route returns 403 with an employee token
  - B4: a raw `router.get('/raw')` added outside the registry returns 404 even with an admin token, and its handler spy is never called
  - B5: an app built with an unannotated def fails to construct
  - B6: path bypass attempts with an employee token never return 2xx: `/ADMIN/users`, `/admin/users/`, `/admin//users`, `/admin/%75sers`, `/auth/../admin/users`
- **validation.test.ts**
  - V1: details carry only `location`, `path` and `message`
  - V2: `?email[$ne]=` style query is rejected
  - V3: a polluted prototype has no effect afterwards (`({}).role === undefined`)
- **rateLimit.test.ts** (low limits injected)
  - RL1: N failed logins for one email lead to 429 `RATE_LIMITED` with `Retry-After`; the correct password is also 429 while limited; `auth.login.rate_limited` is audited
  - RL2: unknown and known emails trip at the same count
  - RL3: successes are not counted
  - RL4: per-IP failures across different emails trip the limit
  - RL5: refresh failures trip a 429
  - RL6: the global limiter returns 429 on `/auth/me`, while `/health` stays exempt
  - RL7: with `TRUST_PROXY_HOPS=0`, a spoofed `X-Forwarded-For` does not reset the counter
- **auditLog.test.ts**
  - AU1: `create` works, `createdAt` is set and there is no `updatedAt`
  - AU2: every blocked path from §3.3 rejects with `AUDIT_LOG_IMMUTABLE`, and the doc count and content are unchanged afterwards
  - AU3: `insertMany` is allowed
  - AU4: unknown fields and unknown actions are rejected
  - AU5: the service strips secret-like metadata keys; metadata over 2 KB is rejected
- **bootstrapAdmin.test.ts**
  - BA1: on an empty DB, an admin is created with `createdBy` null and cost ≥ 12, `admin.bootstrapped` is audited, and the result is `'created'`
  - BA2: a rerun (same or different email) returns `'skipped'`; no new user and the password is unchanged
  - BA3: invalid input throws, naming the key without echoing the password
  - BA4: an existing admin causes a skip
  - BA5: `Employee.create` without `createdBy` and without the bootstrap local fails validation
- **config.features.test.ts**
  - CF1: an authenticated request returns the flags
  - CF2: no token returns 401
- **health.test.ts**: update to `await createApp(testConfig())`; the existing assertions still pass.
- **models.indexes.test.ts**: add AuthSession and AuditLog to `syncIndexes`; assert the TTL index exists and that `currentTokenHash` is not selected by default.

## 16. Implementation sequence
1. Create the branch `phase-02-auth-security` and add the dependencies; `npm audit` must be clean.
2. Shared: constants, errors, schemas and types, with their tests.
3. Env, duration and appConfig, plus the env tests (update the existing defaults test).
4. Mongoose settings; AuditLog, AuthSession and the User invariant; model tests.
5. Audit service, password, tokens and session service, with unit tests.
6. HttpError, error handler, request id, validate, route registry, access gate and rate limiters. Make `createApp` async, migrate health, and update health/env tests to green.
7. Auth, users and config routes and services.
8. Bootstrap script.
9. The full integration suite (§15).
10. Docs: data-model, `.env.example`, bootstrap instructions. Check the contract against the inventory snapshot.
11. Definition of Done: `npm run lint`, `typecheck`, `test`, `build`, `audit:high`, `format:check`.
12. PR with Conventional Commits. Then the independent security-tester review per the playbook.

## 17. Risks
- **bcrypt native build:** possible on Windows ARM64 or unusual toolchains. Mitigation: the `password.ts` facade and the bcryptjs fallback.
- **NAT and shared egress IP:** org traffic may come from one IP. Global and per-IP limits could block legitimate users. Mitigations: failure-only auth limiters, the higher global default, `TRUST_PROXY_HOPS`. The deployment topology needs confirming (D-10).
- **In-memory rate-limit store:** counters reset on restart and are not shared across instances.
- **Concurrent refresh:** races revoke the family. The Phase 5 main process must do single-flight refresh.
- **Two DB reads per authenticated request:** acceptable now; revisit with caching only if measured.
- **Audit immutability is model-level only:** the raw driver or the DB user can still modify. Mitigation: a Phase 10 DB role with insert/find on `auditlogs`, and a Phase 4 hash-chain decision.
- **No transactions:** user creation and its audit entry are not atomic. Mitigation: compensation delete. Alternatively use `MongoMemoryReplSet` in tests plus transactions (Atlas supports them).
- **Gate and router matcher drift:** case sensitivity, trailing slashes, encoding. Covered by B6; both must use identical options.
- **Test runtime:** cost-12 compares take about 250 ms each, roughly 80 logins, so 20–30 s. Hash fixtures once per file.
- **`createApp` becoming async ripples into every test file.**
- **New devs:** `npm run dev` fails until the secrets are set. Document it in `.env.example` and the README.

## 18. Decisions (approved 2026-11-06)
D-1 to D-15 are **approved exactly as recommended**. D-16 is **dropped**.

1. **D-1 Refresh transport: APPROVED.** JSON body; only the Electron main process handles the refresh token, stored with `safeStorage`; no cookie (ADR 0004).
2. **D-2 Env names: APPROVED.** Rename the secret to `REFRESH_TOKEN_SECRET` only; keep `JWT_REFRESH_TTL` unchanged.
3. **D-3 Refresh lifetime: APPROVED.** Absolute 7 days from login, not extended by rotation (weekly re-login).
4. **D-4 Concurrent-refresh grace window: APPROVED.** None; the client serialises refreshes.
5. **D-5 Per-request DB check: APPROVED.** User active, role and session are checked on every request, so revocation is immediate.
6. **D-6 Deactivated login: APPROVED.** The same generic 401 as bad credentials.
7. **D-7 Admin may create administrators: APPROVED.** Via `POST /admin/users`, with role required in the body and a warning-severity audit.
8. **D-8 Initial password: APPROVED.** Admin-supplied. `mustChangePassword` and admin reset (D18) are deferred to Phase 7.
9. **D-9 Password policy: APPROVED.** Min 12 characters, max 72 UTF-8 bytes, no composition rules, as a shared constant.
10. **D-10 Rate-limit defaults and keying: APPROVED.** As in §8, with `TRUST_PROXY_HOPS=0`. Deployment topology (proxy or NAT) is still to be confirmed before production.
11. **D-11 Audit content: APPROVED.** Store IP, user agent and request id; never the typed email of an unknown account. Retention is decided in Phase 4/10.
12. **D-12 Logout access level: APPROVED.** Refresh token in the body, no access token required, idempotent 204 (contract updated).
13. **D-13 Bootstrap: APPROVED.** Env-var CLI; skips if any administrator exists; never generates or prints passwords.
14. **D-14 `GET /config/features`: APPROVED.** Included in Phase 2.
15. **D-15 zod in `@csense/shared`: APPROVED.** Added for the request schemas both sides use.
16. **D-16 Commit the Phase 0 U-decision table: DROPPED.** The Phase 0 decision log cannot be reconstructed. Do not create `docs/architecture/decisions.md`; keep referencing U-ids only where they already appear.

## 19. Docs written by me
- `H:\Projects Stratup\CSense\docs\adr\0004-auth-tokens-and-refresh-transport.md` (Accepted): token design, opaque rotating refresh with reuse detection, body transport vs cookie and the "httpOnly store" justification, jose/bcrypt/express-rate-limit choices, cost floor.
- `H:\Projects Stratup\CSense\docs\adr\0005-authorization-gate-validation-audit.md` (Accepted): route registry plus central access gate, strict validation defaults, error model, append-only AuditLog.
- `H:\Projects Stratup\CSense\docs\api\contract.md` (updated):
  - Phase 2 status line
  - new `refresh` auth level
  - Authentication section with the token response shape
  - error-code table
  - auth route bodies; logout changed from "auth" to "refresh"
  - `POST /admin/users` body and the 409 case
  - deferred Phase 7 user routes, including the D18 reset
  - bootstrap note
  - audited auth events

## 20. Phase 2 acceptance checklist
**Setup**
- [ ] Branch `phase-02-auth-security` exists off `main` (after Phase 1 merge); Conventional Commits; no direct commits to `main`.
- [ ] D-1..D-16 answered and ADR 0004/0005 status set to Accepted (or amended).
- [ ] Dependencies added as listed; `npm audit --audit-level=high` reports no findings.

**Authentication**
- [ ] No self-registration: `/auth/register`, `/auth/signup` and `/users` return 404, and no public route creates users.
- [ ] Bootstrap CLI is idempotent and is the only way to get `createdBy: null` (model invariant tested).
- [ ] Passwords: bcrypt cost from env with a floor of 12 enforced at startup **and** in `hashPassword`; hashes never selected or serialised; rehash-on-login works.
- [ ] Login gives identical responses for unknown email, wrong password and deactivated account, with exactly one bcrypt compare in every case.
- [ ] Access JWT is HS256 via jose with exactly the claims `sub, role, sid, iss, aud, iat, exp, jti`; TTL 15m by default; algorithm, issuer and audience pinned.
- [ ] Refresh token is opaque and stored as an HMAC; rotation on use is atomic; reuse revokes the family and writes a critical audit entry; the absolute 7d expiry is enforced.
- [ ] Logout revokes the session; the session's access tokens fail on their next request.
- [ ] Deactivated users cannot log in, refresh, or use existing access tokens.

**Authorization and input**
- [ ] RBAC: every route is declared in the registry with `access`. The central gate returns 404 for unregistered handlers, 401 without a token, and 403 for the wrong role. The inventory snapshot and the sweep tests pass.
- [ ] zod validates body, params and query on every route; unknown fields and params are rejected; validation details never echo input.
- [ ] Error envelope is uniform with the shared `ERROR_CODES`; no stack traces; `WWW-Authenticate` on 401.
- [ ] helmet headers still present; `Cache-Control: no-store` on `/api/v1`; no CORS; `x-powered-by` off.
- [ ] Rate limits: global (health exempt), per-account and per-IP on login failures, per-IP on refresh failures; 429 uses the envelope and `Retry-After`.

**Audit and environment**
- [ ] AuditLog is append-only: every update, replace, delete and bulkWrite path is rejected (tested). Auth events are written with no secrets.
- [ ] `env.ts` has the new keys with bounds and the distinct-secret check. `.env.example` is in sync, with empty secrets and the generation command. CI needs no secrets.

**Tests, docs and review**
- [ ] All tests in §15 present and green on mongodb-memory-server.
- [ ] `data-model.md` updated (AuthSession, AuditLog, createdBy invariant); contract matches the implemented inventory; bootstrap usage documented.
- [ ] Definition of Done passes: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run format:check` all pass; CI is green.
- [ ] Independent security-tester review has no open High or Critical findings; authz/IDOR tests have been added; `/verify` passes.
