# CSense REST API contract (v1)

Base path: `/api/v1`. Source: `docs/CSense_UseCase_UML.png` and the Client Needs FRs.

**Implemented in Phase 0:** `GET /health` and `GET /health/ready` only. Every other route below is a
contract. No stubs are registered, so unimplemented routes return 404 (deny by default).

## Auth levels
| Level | Meaning |
|---|---|
| public | No token |
| auth | Any valid access token |
| employee | Role `employee` |
| admin | Role `administrator` |
| self | Employee acting on their own data. Lives under `/me`; identity comes from the token only, never from an id parameter |

Anything not listed returns 404. Routes behind a disabled feature flag also return 404.
There is **no self-registration**: `POST /auth/register` must return 404 (tested).

## Error envelope
```json
{ "error": { "code": "NOT_FOUND", "message": "Resource not found", "details": {} } }
```
`details` is optional. Authentication failures use one generic message to prevent account
enumeration. Stack traces and internal messages are never returned.

## Routes

### Ops
| Method | Route | Auth | Phase |
|---|---|---|---|
| GET | `/health` → `{status:'ok'}` | public | **0** |
| GET | `/health/ready` → 200 `{status:'ready'}` / 503 `{status:'unavailable'}` | public | **0** |
| GET | `/config/features` | auth | 2 |

### Authenticate (included by Security Gate and Admin Dashboard)
| Method | Route | Auth | Phase |
|---|---|---|---|
| POST | `/auth/login` (rate-limited) | public | 2 |
| POST | `/auth/refresh` | public + refresh token | 2 |
| POST | `/auth/logout` | auth | 2 |
| GET | `/auth/me` | auth | 2 |

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
| GET, POST | `/admin/users` | admin | 2 (POST), 7 |
| GET, PATCH | `/admin/users/:userId` | admin | 7 |
| POST | `/admin/users/:userId/deactivate`, `/admin/users/:userId/reactivate` | admin | 7 |
| PUT | `/admin/users/:userId/module-assignments` | admin | 7 |

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
entry.
