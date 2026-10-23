# CSense data model (Phase 0)

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
| createdBy | ObjectId → User | default `null` (only the bootstrap admin may be null, U20) |
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
| videoUrl | String | optional, http(s) URL |
| format | `video` \| `interactive` | required (U9) |
| duration | int | required, minutes (U9) |
| isPublished | Boolean | default `false` |

Indexes: `{order:1}` unique · `{isPublished:1,order:1}`

### `badges` (Badge)
`name` (required), `moduleId` → Module (required), `iconMotif` (required).
Index: `{moduleId:1}` **unique** (one badge per module, U5).

### `userprogresses` (UserProgress)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| moduleId | ObjectId → Module | required |
| status | `locked` \| `unlocked` \| `in_progress` \| `completed` | default `locked` (U9) |
| quizScore | int 0-100 | optional |
| quizPassed | Boolean | default `false` |
| attempts | int | default 0 |
| completedAt | Date | optional |

Indexes: `{userId:1,moduleId:1}` unique · `{moduleId:1,status:1}`

### `assessments` (Assessment; Quiz, FinalTest discriminators)
| Field | Type | Rules |
|---|---|---|
| kind | `Quiz` \| `FinalTest` | discriminator key (**not in diagram**) |
| title | String | required |
| questions | Question[] (embedded) | at least 1 (`1..*`) |
| passingScore | int percent 0-100 | default 70 (configurable per assessment) |
| moduleId *(Quiz)* | ObjectId → Module | required |

Embedded **Question** (`_id: false`): `questionId` (auto ObjectId), `text` (required),
`options` (String[], at least 2), `correctAnswer` (**integer index into `options`**, U10;
`select: false`; must satisfy `0 <= i < options.length`). Any edit that reorders options must remap
`correctAnswer` (Phase 7).

Indexes: `{kind:1}` · `{moduleId:1}` unique where `kind = Quiz` · `{kind:1}` unique where
`kind = FinalTest` (only one final test, U12)

### `quizattempts` (QuizAttempt, append-only)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| type | `Quiz` \| `FinalTest` | required |
| refId | ObjectId, `refPath: 'type'` | required ("submitted to" one Assessment) |
| answers | `{questionId, selectedIndex, correct}[]` | required (Answer shape, U3) |
| score | int 0-100 | required |
| passed | Boolean | required |
| attemptedAt | Date | set on create; no `updatedAt` |

Indexes: `{userId:1,refId:1,attemptedAt:-1}` · `{refId:1,passed:1}`

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

## Embedded vs referenced
| Relationship | Choice | Why |
|---|---|---|
| Assessment ◆ Question | Embedded | UML stereotype; composition; small, always read together |
| Module ◆ Quiz | Referenced (unique `moduleId` on Quiz) | Quiz has its own identity, referenced by attempts |
| User → UserProgress / QuizAttempt / RiskProfile | Own collections | Cross-user admin queries; unbounded growth |
| Badge → Module | Referenced | As drawn |
| Employee earns Badge | Not stored yet (U4, Phase 4) | Proposed `earnedBadges[{badgeId, awardedAt}]` on Employee |

## Planned additions (not in the diagram; built in the owning phase)
refresh tokens (Phase 2) · immutable audit log (Phases 2/4) · escalations (4) · gate state (5) ·
onboarding flag (6) · module assignments (7) · phishing outcomes and review cycles (flagged) ·
interactive exercise data (3/6). See the Phase 0 plan section 3.4.
