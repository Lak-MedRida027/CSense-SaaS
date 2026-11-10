# ADR 0004: Authentication tokens, refresh-token transport and auth libraries

- Status: Accepted (Phase 2 plan approved 2026-11-06)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Follows up: ADR 0001 "Follow-ups: ADR for refresh-token transport in the desktop client"

## Context
CLAUDE.md fixes the security baseline: access token ~15 min, refresh token ~7 days "in an httpOnly
store", refresh rotated on use, bcrypt cost >= 12, no self-registration, RBAC deny-by-default. The
client is an Electron desktop app (ADR 0001), not a browser site: its renderer is the only context
that runs untrusted-ish web content (and is the XSS target), while the main process is a privileged
Node context the renderer cannot read (contextIsolation, sandbox, no nodeIntegration). The API is a
single Express service; nothing else verifies its tokens. Development is on Windows; CI is Ubuntu.

## Decision

### Access token
- Compact JWS, **HS256**, signed and verified with `jose` (v6). Verification pins
  `algorithms: ['HS256']`, `issuer: 'csense-api'`, `audience: 'csense-desktop'`, and requires
  `sub`, `role`, `sid`, `iat`, `exp`, `jti`. The decoded payload is re-validated with zod.
- Claims are exactly: `sub` (User ObjectId), `role` (`employee` | `administrator`), `sid`
  (AuthSession id, opaque), `iss`, `aud`, `iat`, `exp`, `jti`. No email, name, department or any
  secret. `sid` is needed so logout and reuse detection can kill outstanding access tokens.
- Lifetime `JWT_ACCESS_TTL`, default 15m, bounded 1m..30m at startup.
- Every authenticated request re-reads the user (`isActive`, `role`) and the session
  (`revokedAt`, `expiresAt`). Deactivation, logout and reuse detection therefore take effect
  immediately, not after up to 15 minutes. The role in the token must equal the stored role or the
  request is 401. Cost: two indexed primary-key reads per request, acceptable at CSense's scale.
- Symmetric HS256 is chosen over RS256/EdDSA because the issuer and the only verifier are the same
  process; asymmetric keys add key management with no benefit until a second verifier exists.

### Refresh token
- **Opaque, not a JWT**: `<sessionId>.<32 random bytes, base64url>`. The server must look it up to
  rotate it anyway, so a self-describing JWT adds algorithm-confusion surface and nothing else.
- Stored only as `HMAC-SHA256(REFRESH_TOKEN_SECRET, token)` on an `AuthSession` document
  (`currentTokenHash` plus a capped list of `previousTokenHashes`). A database leak alone does not
  yield usable tokens, and the secret alone does not either.
- **Rotation on every use** with an atomic conditional update (`currentTokenHash == presented`,
  not revoked, not expired). The presented hash moves to `previousTokenHashes`.
- **Reuse detection**: if a presented token matches a previous hash of its session, the whole
  session (the token family) is revoked (`revokedReason: 'reuse_detected'`), every access token
  carrying that `sid` stops working on its next request, and a `critical` audit entry is written.
  A token whose `sid` exists but whose hash matches neither current nor previous is rejected
  without revoking anything (prevents a cheap denial of service with a guessed session id).
- **Absolute lifetime**: the session expires `JWT_REFRESH_TTL` (default 7d, bounded 1h..14d) after
  login; rotation does not extend it, so every user re-enters credentials at least weekly.
- No grace window for concurrent refreshes: the losing request looks like reuse and revokes the
  family. The desktop client must serialise refreshes (single-flight in the main process, Phase 5).
- Logout revokes the session identified by the presented refresh token. Deactivating a user
  (Phase 7) calls `revokeAllForUser`.

### Transport: JSON body, stored by the Electron main process (not a cookie)
- `POST /auth/login` and `POST /auth/refresh` return the refresh token in the JSON body;
  `/auth/refresh` and `/auth/logout` take it in the JSON body. The server sets no cookies and enables
  no CORS. All auth responses carry `Cache-Control: no-store`.
- Phase 5 constraint: only the Electron **main process** calls the auth endpoints and holds the
  refresh token, persisted with `safeStorage` (DPAPI on Windows, Keychain on macOS). The preload
  bridge exposes `login`, `logout` and session state, never the refresh token.
- Why this meets CLAUDE.md's "httpOnly store": `httpOnly` exists to keep a token out of reach of page
  JavaScript. In Electron the page is the renderer; a value held only in the main process is equally
  unreachable from renderer JavaScript, and `safeStorage` additionally encrypts it at rest with the
  OS user's key, which Chromium's cookie jar does not do unless the cookie-encryption fuse is turned
  on. A cookie would also need CORS with credentials and SameSite handling for a `file://` or custom
  protocol origin, and would reintroduce an ambient credential (CSRF surface) that a body token avoids.
- Rejected: httpOnly cookie (reasons above); refresh token in renderer `localStorage` (XSS-readable).

### Libraries
- `jose` ^6 for JWT: zero dependencies, ESM-native, typed, explicit algorithm allowlist.
  `jsonwebtoken` rejected: CommonJS, older transitive dependencies, history of algorithm-confusion
  advisories.
- `bcrypt` ^6 (native, prebuilt N-API binaries bundled for win32/linux/darwin x64 and arm64, so no
  node-gyp or Visual Studio Build Tools on supported platforms; it runs on the libuv threadpool and
  does not block the event loop). Wrapped behind `server/src/features/auth/password.ts`, so falling
  back to `bcryptjs` ^3 (pure JS, ~30% slower, runs on the main thread) is a one-file change if a
  platform lacks a prebuild. This confirms ADR 0001.
- `express-rate-limit` ^8 with its in-memory store (single API instance). A shared store (Mongo or
  Redis) is required before running more than one instance.
- Cost: `BCRYPT_COST` default 12, rejected at startup below 12 or above 15; `hashPassword` also
  refuses a cost below 12 (defence in depth). Hashes with a lower cost are rehashed on successful login.

## Decisions (approved 2026-11-06, Phase 2 plan section 18)
All approved as the recommended defaults:
- D-1 Refresh token travels in the JSON body; only the Electron main process holds it (`safeStorage`); no cookie.
- D-2 Rename the secret to `REFRESH_TOKEN_SECRET`; keep `JWT_REFRESH_TTL`.
- D-3 Absolute 7-day session lifetime from login, not extended by rotation.
- D-4 No grace window for concurrent refreshes; the client serialises refreshes.
- D-5 Per-request DB check of user active, role and session.
- D-6 Deactivated accounts get the same generic 401 as bad credentials.
- D-7 Administrators may create administrators via `POST /admin/users` (audited, warning severity).
- D-8 Admin-supplied initial password; forced change and admin reset (D18) deferred to Phase 7.
- D-9 Password policy: min 12 characters, max 72 UTF-8 bytes, no composition rules (shared constant).
- D-10 Rate-limit defaults and keying as in the plan; `TRUST_PROXY_HOPS=0`.
- D-11 Audit stores IP, user agent and request id; never the typed email of an unknown account.
- D-12 Logout authenticated by the refresh token in the body; idempotent 204.
- D-13 Bootstrap admin via env-var CLI; skips if any administrator exists; never generates or prints passwords.
- D-14 `GET /config/features` included in Phase 2.
- D-15 `zod` added to `@csense/shared` for request schemas.

## Amendments from the Phase 2 security review
- **Failed-login response-time floor (P2-L1).** Stored hashes keep the bcrypt cost they were created
  with until the user next logs in successfully, while the dummy hash used for unknown emails is
  created at the current `BCRYPT_COST`. After any `BCRYPT_COST` change a failed login for an existing
  account therefore does more or less bcrypt work than one for an unknown email, which is measurable
  over the network. Rehashing every account is impossible without their passwords, so every failed
  login (unknown email, wrong password, inactive account, over-72-byte password) now takes at least
  `AUTH_FAILED_LOGIN_MIN_MS` (default 1000, 0 disables) plus random jitter of up to 10% (max 100 ms).
  Successful logins are not delayed. Caveats: the floor must exceed one bcrypt compare at the highest
  cost in use (cost 15 is roughly 2 s on slow hardware, so raise the floor together with the cost); a
  floor of 0 re-opens the channel; the delay holds a request open, so the per-IP limiter is what bounds
  the resulting concurrency.
- **Floor calibration and adaptation (P2-L6).** A fixed floor is exceeded when bcrypt work plus
  threadpool queueing outlasts it (cost 15 alone is about 1.9 s; 16 concurrent cost-12 compares about
  1.1 s). At start-up `createApp` times three dummy-hash compares at the configured cost and raises the
  effective floor to `max(AUTH_FAILED_LOGIN_MIN_MS, 3 x median)`, logged once. It also keeps a rolling
  window (32) of recent failed-login work durations and keeps the floor at least 1.1 x the largest,
  capped at 15 s. Residual: under extreme sustained load the first slow failures can precede
  adaptation, and a flood of failures can raise the floor for everyone's failures until the window
  rolls over (bounded by the per-IP limiter and the cap).
- **Account-wide signal (P2-L7).** The counter behind `auth.login.account_targeted` is fed by the
  login service at the moment it decides a credentials failure, not on response `finish`, so
  dropped connections cannot hide guesses. The warning is written in the background.
- **Bootstrap index (P2-L5).** `bootstrapAdmin` builds and verifies the unique partial
  `createdBy: null` index before doing anything and refuses to run without it.
- **Login rate limits (P2-M1).** The per-IP limiter runs first. The hard account limit is keyed per
  (normalised email, IP) and counts only requests that passed validation and ended in a credentials
  failure. Across all IPs, an account that collects `AUTH_LOGIN_TARGETED_THRESHOLD` failures in a
  window gets one `auth.login.account_targeted` warning (no block), so a distributed guessing run is
  visible without handing an attacker a lockout lever. The env key `AUTH_LOGIN_MAX_PER_ACCOUNT` was
  renamed `AUTH_LOGIN_MAX_PER_ACCOUNT_IP`.
- **Logout reuse (P2-L2).** Presenting a spent refresh token at `/auth/logout` revokes the session
  with reason `reuse_detected` and writes the critical `auth.refresh.reuse_detected` entry; the
  response stays 204.
- **Secrets (P2-L4).** See Environment below.

## Consequences
- Positive: immediate revocation; no secrets or PII in tokens; replayed refresh tokens kill the
  stolen family; nothing the renderer can read can mint a session; no cookie/CORS/CSRF surface.
- Negative: two DB reads per authenticated request; concurrent refreshes log the user out unless
  the client serialises them; in-memory rate-limit counters reset on restart and are not shared across
  instances; `safeStorage` on Linux without a keyring falls back to weak storage (Windows is first).
- Environment: `JWT_ACCESS_SECRET` and `REFRESH_TOKEN_SECRET` (renamed from the placeholder
  `JWT_REFRESH_SECRET`, because the refresh token is not a JWT), each required to look generated (base64url
  charset, at least 43 characters, at least 16 distinct characters; review fix P2-L4) and to differ; `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_COST`.
- Follow-ups: Phase 5 ADR on whether the main process also holds the access token and proxies every
  API call (recommended); Phase 10 shared rate-limit store if the API is scaled out.

## Amendment (Phase 5 desktop client)
The Phase 5 follow-up is resolved by ADR 0014: the Electron main process holds both tokens (refresh token encrypted with `safeStorage`, memory-only when encryption is unavailable, never plaintext; access token in main memory), every API call goes through a main-process client with a fixed operations table and single-flight refresh, and the renderer never sees a token. A crash between the server rotating the refresh token and the client persisting it signs the user out at next launch (treated as reuse); that is the accepted secure outcome.
