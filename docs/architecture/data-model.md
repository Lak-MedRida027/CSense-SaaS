# CSense data model (Phase 0, extended in Phase 2)

Source of truth: `docs/CSense_Class_UML.png`. Implemented as Mongoose schemas in `server/src/models/`
(schema only, no business logic). Shared enums and constants live in `shared/src/constants/`.

## Conventions (every collection)
- `strict: 'throw'`: unknown fields are rejected, never silently dropped.
- Integer attributes (`int` in the UML) are `Number` with an `Number.isInteger` validator.
- `timestamps: true` (`createdAt`, `updatedAt`) is **not in the diagram**. Added for auditability
  (FR12, FR13, ISO 27001). Where the UML names a date field it is reused (`User.createdAt`,
  `Assessment.updatedAt`, `QuizAttempt.attemptedAt`).
- `toJSON` drops `_id`/`__v` and exposes `id`; secrets are never serialised.

## Inheritance mapping (decisions U1, U2)
| UML | Collection | Discriminator key | Values |
|---|---|---|---|
| User → Employee, Administrator | `users` | `role` | `employee`, `administrator` |
| Assessment → Quiz, FinalTest | `assessments` | `kind` (**not in diagram**) | `Quiz`, `FinalTest` |

## Collections

### `users` (User; Employee, Administrator discriminators)
| Field | Type | Rules |
|---|---|---|
| name | String | required, trim, max 120 |
| email | String | required, lowercase, trim; **unique** |
| passwordHash | String | required, `select: false`, stripped from JSON |
| role | `employee` \| `administrator` | required; discriminator key |
| department | String | optional (free text, U9) |
| isActive | Boolean | default `true` (deactivation is soft) |
| createdBy | ObjectId → User | default `null`; **required on create** for every account except the bootstrap administrator (U20). Enforced by a `pre('validate')` hook on the base schema; the bootstrap script opts in with `doc.$locals.bootstrap = true` |
| totalXP *(Employee)* | int | default 0, min 0 |
| level *(Employee)* | Apprentice \| Aware \| Practitioner \| Guardian \| Defender | default Apprentice |

Indexes: `{email:1}` unique · `{role:1,isActive:1}` · `{department:1}`

### `modules` (Module)
| Field | Type | Rules |
|---|---|---|
| order | int | required, min 1; **unique** |
| title | String | required, max 200 |
| description | String | required |
| content | String | default `''` |
| videoUrl | String | optional, http(s) URL (authoring requires https) |
| captionsUrl | String | optional, http(s) URL (WebVTT) |
| transcript | `{startSeconds int, text}[]` | max 500 cues, `_id: false` |
| keyTakeaways | String[] | each 1..300, max 10 |
| exercises | Exercise[] (embedded) | max 20 |
| format | `video` \| `interactive` | required (U9) |
| duration | int | required, minutes (U9) |
| isPublished | Boolean | default `false` |

Embedded **Exercise** (`_id: false`, Phase 3): `exerciseId` (auto ObjectId), `prompt`, optional `artifact` (plain text), `options` (2..6), `correctAnswer` (index; `select: false`), `explanation` (`select: false`).

Publish invariant (`pre('validate')`, only when `isPublished`): a `video` module needs `videoUrl`; an `interactive` module needs at least one exercise.

Indexes: `{order:1}` unique · `{isPublished:1,order:1}`

### `badges` (Badge)
`name` (required), `moduleId` → Module (required), `iconMotif` (required).
Index: `{moduleId:1}` **unique** (one badge per module, U5).

### `userprogresses` (UserProgress)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| moduleId | ObjectId → Module | required |
| status | `in_progress` \| `completed` | **stored facts only** (ADR 0006); `locked` and `unlocked` are derived by `deriveModuleStates` and never stored |
| quizScore | int 0-100 | best score (`$max`) |
| quizPassed | Boolean | default `false`; the first pass sets it together with `completedAt` |
| attempts | int | submitted + abandoned + expired attempts |
| completedAt | Date | optional |
| startedAt | Date | set on insert |
| contentCompletedAt | Date or null | content gate for the quiz |
| exerciseAnswers | `{exerciseId, selectedIndex, correct, answeredAt}[]` | first answer per exercise, max 20 |
| lastAttemptAt | Date or null | |

Indexes: `{userId:1,moduleId:1}` unique · `{moduleId:1,status:1}`

### `assessments` (Assessment; Quiz, FinalTest discriminators)
| Field | Type | Rules |
|---|---|---|
| kind | `Quiz` \| `FinalTest` | discriminator key (**not in diagram**) |
| title | String | required |
| questions | Question[] (embedded) | at least 1 (`1..*`) |
| passingScore | int percent 0-100 | default 70 (configurable per assessment) |
| questionsPerSession | int >= 1 or null | how many questions of the pool a session serves (null serves all); may not exceed the pool. Published content keeps a pool of at least four times this (authoring schema: quiz 5 from 20+, final test 15 from 60+) |
| moduleId *(Quiz)* | ObjectId → Module | required |

Embedded **Question** (`_id: false`): `questionId` (auto ObjectId), `text` (required),
`options` (String[], 2..6, each max 300), `correctAnswer` (**integer index into `options`**, U10;
`select: false`; must satisfy `0 <= i < options.length`), `explanation` (max 1000, default `''`, `select: false`). `text` max 1000. Any edit that reorders options must remap
`correctAnswer` (Phase 7).

Indexes: `{kind:1}` · `{moduleId:1}` unique where `kind = Quiz` · `{kind:1}` unique where
`kind = FinalTest` (only one final test, U12)

### `quizattempts` (QuizAttempt, append-only)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| type | `Quiz` \| `FinalTest` | required |
| refId | ObjectId, `refPath: 'type'` | required ("submitted to" one Assessment) |
| answers | `{questionId, selectedIndex int or null, correct}[]` | one per served question, in served order (U3; `null` = unanswered) |
| score | int 0-100 | required |
| passed | Boolean | required |
| attemptedAt | Date | set on create; no `updatedAt` |
| sessionId | ObjectId → AssessmentSession | required, **unique** |
| moduleId | ObjectId or null | denormalised; null for the final test |
| attemptNumber | int >= 1 | per (user, assessment) |
| endReason | `submitted` \| `abandoned` \| `expired` | required |
| correctCount, totalCount | int | |
| passingScore | int 0-100 | snapshot at session start |

Indexes: `{userId:1,refId:1,attemptedAt:-1}` · `{refId:1,passed:1}` · `{sessionId:1}` unique · `{userId:1,attemptedAt:-1,_id:-1}` · `{userId:1,refId:1,passed:1}`

Also unique: `{userId:1,refId:1,attemptNumber:1}`.

Append-only (Phase 3): the shared `appendOnly` plugin makes every update, replace and delete path, and any aggregation containing `$merge` or `$out`, throw `QuizAttemptImmutableError`; only `create` and `insertMany` write. The same aggregation guard protects `auditlogs`.

Startup builds and verifies (key, `unique`, partial filter, not just the name) the unique indexes the learning engine relies on (`server/src/db/learningIndexes.ts`); `/health/ready` is `unavailable` while one is missing.

### `assessmentsessions` (AssessmentSession, Phase 3, not in the diagram; ADR 0007)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| kind | `Quiz` \| `FinalTest` | required |
| assessmentId | ObjectId → Assessment | required |
| moduleId | ObjectId or null | required for Quiz |
| status | `open` \| `submitted` \| `abandoned` \| `expired` | default `open` |
| questions | `{questionId, optionCount, correctAnswer}[]` | served (shuffled) order; `correctAnswer` is a key snapshot, `select: false`; `toJSON` never emits `questions` |
| attemptNumber | int or null | reserved from `attemptcounters` after the insert succeeds, in the conditional update that also checks the cooldown |
| passingScore | int | snapshot |
| expiresAt | Date | start + `ASSESSMENT_SESSION_TTL` |
| closedAt | Date or null | |
| startedAt | Date | `timestamps: { createdAt: 'startedAt', updatedAt: false }` |

Indexes: `{userId:1,assessmentId:1}` unique where `status = open` (one open session) · TTL `{expiresAt:1}` (30 days past expiry).

### `attemptcounters` (AttemptCounter, Phase 3, not in the diagram)
Per-(employee, assessment) ledger: `seq` (attempt numbers, atomic `$inc` at session start), `attempts`, `bestScore` and `firstPassAt` (set once by a conditional write, which decides the first pass and fires the completion hooks exactly once), `consecutiveFails` (failure streak, reset by a pass or when a cooldown starts) and `cooldownUntil` (new sessions are refused until then). Unique index `{userId:1,assessmentId:1}`.

### `riskprofiles` (RiskProfile)
`userId` → User (required, **unique**), `knowledgeScore`, `behaviouralScore`, `simulationScore`,
`engagementScore` (int 0-100, default 0 pending U7), `riskLevel` (`Low` \| `Medium` \| `High`,
default `Low`). Indexes: `{userId:1}` unique · `{riskLevel:1}`.
Weights (30/25/30/15) and the Low/Medium/High → Green/Amber/Red mapping live in
`shared/src/constants/risk.ts`.

### `phishingsimulations` (PhishingSimulation, behind `FEATURE_PHISHING`)
`campaignName` (required), `emailTemplate` (required), `status` (`draft` \| `scheduled` \|
`deployed` \| `completed`, default `draft`), `deployedAt`, `configuredBy` → User (required;
**not an attribute in the diagram**, derived from the Administrator "configures" association).
Index: `{status:1}`.

### `authsessions` (AuthSession, Phase 2, not in the diagram; ADR 0004)
One document per refresh-token family (one login).
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| currentTokenHash | String (hex HMAC-SHA256) | required, `select: false`, never serialised |
| previousTokenHashes | String[] | default `[]`, `select: false`, capped at the last 50 |
| expiresAt | Date | required; login + `JWT_REFRESH_TTL`, absolute (rotation never extends it) |
| rotatedAt | Date or null | |
| rotationCount | int | default 0 |
| revokedAt | Date or null | default `null` |
| revokedReason | `logout`, `reuse_detected`, `user_inactive`, `admin_revoked` or null | |
| ip, userAgent | String | captured at login; max 64 / 256 |

Indexes: `{userId:1,revokedAt:1}` · TTL `{expiresAt:1}` (`expireAfterSeconds` 30 days, so expired
sessions stay available for investigations for a month).

### `auditlogs` (AuditLog, Phase 2, append-only; ADR 0005)
| Field | Type | Rules |
|---|---|---|
| action | enum `AUDIT_ACTIONS` (shared) | required: `auth.login.succeeded`, `auth.login.failed`, `auth.login.rate_limited`, `auth.login.account_targeted`, `auth.refresh.reuse_detected`, `auth.refresh.denied`, `auth.logout`, `user.created`, `admin.bootstrapped`, `learning.seed.reset`, `learning.assessment.cooldown` (Phase 4 appends risk and escalation actions) |
| outcome | `success` or `failure` | required |
| severity | `info`, `warning` or `critical` | default `info` |
| actorId, actorRole | ObjectId or null, Role or null | null when anonymous or system |
| targetType, targetId | `user` or `session`, ObjectId (both nullable) | |
| ip, userAgent, requestId | String or null | max 64 / 256 / 64 |
| metadata | Mixed | default `{}`; at most 2 KB of JSON; secret-looking keys (`pass`, `token`, `secret`, `hash`) are stripped by the audit service |
| createdAt | Date | `timestamps: { createdAt: true, updatedAt: false }` |

Indexes: `{createdAt:-1}` · `{actorId:1,createdAt:-1}` · `{targetId:1,createdAt:-1}` · `{action:1,createdAt:-1}`.

Immutability: Mongoose middleware throws `AuditLogImmutableError` (`AUDIT_LOG_IMMUTABLE`) for `save`
on an existing document, `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`,
`findOneAndReplace`, `deleteOne` (query and document), `deleteMany`, `findOneAndDelete` and
`bulkWrite`. Only `create` and `insertMany` write. This is model-level protection; the raw driver or
a database user with write rights can still modify the collection (Phase 10: restrict the
application's DB role to insert/find on `auditlogs`). Test cleanup uses driver-level `deleteMany`.

## Global Mongoose settings
`server/src/db/mongooseSettings.ts` sets `strictQuery: true` and `sanitizeFilter: true` (a
`$`-operator inside a filter value is wrapped in `$eq`; internal queries that need operators use
`mongoose.trusted()`). It is imported by `models/index.ts` and `db/connect.ts`.

## Embedded vs referenced
| Relationship | Choice | Why |
|---|---|---|
| Assessment ◆ Question | Embedded | UML stereotype; composition; small, always read together |
| Module ◆ Quiz | Referenced (unique `moduleId` on Quiz) | Quiz has its own identity, referenced by attempts |
| User → UserProgress / QuizAttempt / RiskProfile | Own collections | Cross-user admin queries; unbounded growth |
| Badge → Module | Referenced | As drawn |
| Employee earns Badge | Not stored yet (U4, Phase 4) | Proposed `earnedBadges[{badgeId, awardedAt}]` on Employee |

## Planned additions (not in the diagram; built in the owning phase)
Refresh-token sessions and the append-only audit log were added in Phase 2 (above).

escalations (4) · gate state (5) ·
onboarding flag (6) · module assignments (7) · phishing outcomes and review cycles (flagged) ·
(interactive exercise data landed in Phase 3). See the Phase 0 plan section 3.4.
