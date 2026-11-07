# CSense REST API contract (v1)

Base path: `/api/v1`. Source: `docs/CSense_UseCase_UML.png` and the Client Needs FRs.

**Implemented:** Phase 0 `GET /health` and `GET /health/ready`; Phase 2 the four Authenticate
routes (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`), `POST /admin/users` and
`GET /config/features`. These eight are the whole route inventory (snapshot-tested in
`server/test/rbac.denyByDefault.test.ts`). Every other route below is a contract. No stubs are registered, so unimplemented routes return 404 (deny by default).

## Auth levels
| Level | Meaning |
|---|---|
| public | No token |
| refresh | No access token; a valid refresh token in the JSON body (ADR 0004) |
| auth | Any valid access token |
| employee | Role `employee` |
| admin | Role `administrator` |
| self | Employee acting on their own data. Lives under `/me`; identity comes from the token only, never from an id parameter |

Anything not listed returns 404. Routes behind a disabled feature flag also return 404.
There is **no self-registration**: `POST /auth/register` must return 404 (tested).
Every route is declared in the server's route registry with one of these levels; the central access
gate rejects anything not in the registry (ADR 0005). Role matching is exact: an administrator does
not inherit `employee` routes.

## Authentication (Phase 2, ADR 0004)
- Access token: JWT (HS256), sent as `Authorization: Bearer <token>`, lifetime 15 min. Claims:
  `sub`, `role`, `sid`, `iss`, `aud`, `iat`, `exp`, `jti` only.
- Refresh token: opaque string, returned and accepted **in the JSON body** (never a cookie),
  rotated on every use, absolute lifetime 7 days from login. Reusing a rotated refresh token revokes
  the whole session. Only the Electron main process handles it (Phase 5).
- Every auth response carries `Cache-Control: no-store`. A deactivated account, a logged-out
  session or a revoked session makes its access tokens fail with 401 on the next request.

Token response (login adds `user`):
```json
{
  "tokenType": "Bearer",
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 900,
  "refreshToken": "<opaque>",
  "refreshTokenExpiresAt": "2026-11-13T09:00:00.000Z",
  "user": { "id": "...", "name": "...", "email": "...", "role": "employee", "isActive": true, "createdBy": "...", "createdAt": "...", "totalXP": 0, "level": "Apprentice" }
}
```

## Error envelope
```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found", "details": {} } }
```
`details` is only used by `VALIDATION_ERROR` (`{ issues: [{ location, path, message }] }`, never the
submitted value). Authentication failures use one generic message per endpoint to prevent account
enumeration. Stack traces and internal messages are never returned.

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | body, params or query fail the zod schema (including unknown fields) |
| `INVALID_JSON` | 400 | malformed JSON body |
| `BAD_REQUEST` | 400 | other client errors from the body parser |
| `INVALID_CREDENTIALS` | 401 | login failed, for any reason (unknown email, wrong password, deactivated) |
| `UNAUTHENTICATED` | 401 | access token missing, malformed, invalid, expired, or its user/session is no longer valid. Sent with `WWW-Authenticate: Bearer` |
| `INVALID_REFRESH_TOKEN` | 401 | refresh token unknown, expired, revoked, reused, or its user is deactivated |
| `FORBIDDEN` | 403 | authenticated but wrong role |
| `NOT_FOUND` | 404 | route or resource does not exist (or is not in the registry) |
| `CONFLICT` | 409 | unique constraint, e.g. email already in use (admin routes only) |
| `PAYLOAD_TOO_LARGE` | 413 | body over `JSON_BODY_LIMIT` |
| `RATE_LIMITED` | 429 | rate limit hit; `Retry-After` and `RateLimit` headers set |
| `INTERNAL_ERROR` | 500 | anything else |

## Routes

### Ops
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/health` → `{status:'ok'}` | public | **0** |
| GET | `/health/ready` → 200 `{status:'ready'}` / 503 `{status:'unavailable'}` | public | **0** |
| GET | `/config/features` → `{phishing, continuousReview}` | auth | 2 |

### Authenticate (included by Security Gate and Admin Dashboard)
| Method | Route | Body | Response | Auth | Phase |
|---|---|---|---|---|---|
| POST | `/auth/login` (rate-limited per email and per IP, failures only) | `{email, password}` | 200 token response + `user` | public | 2 |
| POST | `/auth/refresh` (rate-limited per IP, failures only) | `{refreshToken}` | 200 token response | refresh | 2 |
| POST | `/auth/logout` (idempotent; 204 even for an unknown token) | `{refreshToken}` | 204 | refresh | 2 |
| GET | `/auth/me` | none | 200 `UserDTO` (`EmployeeDTO` / `AdministratorDTO`) | auth | 2 |

### Interact with Security Gate / Escalate Restricted Access
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/gate/status` | employee | 5 |
| POST | `/gate/attempts` | employee (pre-auth flow per U15) | 5 |
| POST | `/admin/users/:userId/restore-access` | admin | 5/7 |

### View Learning Content / Complete Learning Module (→ Award Badge)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/modules` | employee | 3 |
| GET | `/modules/:moduleId` (403/423 if locked) | employee | 3 |
| POST | `/modules/:moduleId/start` | employee | 3 |

Completion and badge award are server-side effects of a passing quiz attempt, never a client call.

### Take Module Quiz (→ Update Risk Profile)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/modules/:moduleId/quiz` (never includes answer keys) | employee | 3 |
| POST | `/modules/:moduleId/quiz/attempts` (graded server-side) | employee | 3 |
| GET | `/me/attempts`, `/me/attempts/:attemptId` | self | 3 |

### Take Final Assessment
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/final-test` (locked until all modules passed) | employee | 3 |
| POST | `/final-test/attempts` | employee | 3 |

### View Progress Dashboard
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/me/dashboard`, `/me/progress`, `/me/badges` | self | 3-6 |
| PATCH | `/me/onboarding` (FR4; no use case in the UML) | self | 6 |

### Respond to Phishing Simulation (flag `FEATURE_PHISHING`)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET/POST | `/phishing/t/:token` (signed, single-use) | public token | flag |
| POST | `/me/phishing/reports` | self | flag |

### Access Admin Dashboard
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/admin/dashboard/kpis`, `/admin/progress`, `/admin/modules/completion`, `/admin/scoreboard`, `/admin/badges/summary` | admin | 7 |

### Manage Users
| Method | Route | Auth | Phase |
|---|---|---|---|
| POST | `/admin/users` body `{name, email, password, role, department?}` → 201 `UserDTO`; 409 `CONFLICT` on duplicate email; `createdBy` is always the calling admin | admin | 2 |
| GET | `/admin/users` | admin | 7 |
| GET, PATCH | `/admin/users/:userId` | admin | 7 |
| POST | `/admin/users/:userId/deactivate` (also revokes all sessions), `/admin/users/:userId/reactivate` | admin | 7 |
| POST | `/admin/users/:userId/password` (administrator reset, D18) | admin | 7 |
| PUT | `/admin/users/:userId/module-assignments` | admin | 7 |

The first administrator is created by the `bootstrap:admin` CLI (decision U20), never over HTTP.

### Manage Module Content
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/modules` | admin | 7 |
| GET, PATCH, DELETE | `/admin/modules/:moduleId` | admin | 7 |
| POST | `/admin/modules/:moduleId/publish`, `/unpublish` | admin | 7 |
| PUT | `/admin/modules/order` | admin | 7 |
| GET, PUT | `/admin/modules/:moduleId/quiz` | admin | 3/7 |
| GET, POST, PATCH | `/admin/badges[/:badgeId]` | admin | 4/7 |

### Manage Final Assessment
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, PUT | `/admin/final-test` | admin | 7 |

### View Employee Risk Profiles
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/admin/risk-profiles?level=` | admin | 4/7 |
| GET | `/admin/users/:userId/risk-profile` | admin | 4/7 |

### Review Governance Escalations
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/admin/escalations` | admin | 4 |
| GET, PATCH | `/admin/escalations/:escalationId` | admin | 4 |
| GET | `/admin/audit-logs` (read-only) | admin | 4 |

### Generate Awareness Reports
| Method | Route | Auth | Phase |
|---|---|---|---|
| POST | `/admin/reports` | admin | 7 |
| GET | `/admin/reports/:reportId` | admin | 7 |

### Configure Phishing Campaigns (flag `FEATURE_PHISHING`)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/phishing-campaigns` | admin | flag |
| GET, PATCH | `/admin/phishing-campaigns/:campaignId` | admin | flag |
| POST | `/admin/phishing-campaigns/:campaignId/deploy` | admin | flag |
| GET | `/admin/phishing-campaigns/:campaignId/outcomes` | admin | flag |

### Continuous awareness (flag `FEATURE_CONTINUOUS_REVIEW`; FR16, no use case in the UML)
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET, POST | `/admin/review-cycles` | admin | flag |
| GET | `/me/reviews` | self | flag |

## System-triggered use cases (no route)
Award Badge, Update Risk Profile, Trigger Governance Escalation and Escalate Restricted Access are
internal services called by the routes above. Each one that escalates writes an immutable audit-log
entry (Phase 2 provides the append-only `AuditLog` model and service). Authentication events
(login success/failure, refresh-token reuse, logout, user creation, admin bootstrap) are audited too.
