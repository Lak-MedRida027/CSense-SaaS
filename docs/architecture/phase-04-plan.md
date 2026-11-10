# CSense Phase 4 plan: gamification, the risk engine and governance escalation

Status: **Approved 2026-11-07.** Decisions D4-1 to D4-26 (section 17) approved as recommended. Branch:
`phase-04-gamification-risk`, stacked on `phase-03-learning-engine` (rebased onto `main` once Phase 3
merges). ADRs: 0009, 0010, 0011, 0012 (Accepted). Where this plan names Phase 3 internals that the
implementation changed (hook return type, effects whitelist, session and attempt field names), the
implemented Phase 3 code wins.

I wrote no feature code and changed no existing file. I created this plan and four ADRs.

## 0. Sources and caveats
- **Read:**
  - CLAUDE.md, docs/api/contract.md, docs/architecture/data-model.md, the Phase 2 and Phase 3 plans, ADR 0001 to 0008, docs/BUILD_PLAYBOOK.md (Phases 4, 5 and 7), docs/design/screens.md and tokens.md
  - both UML PNGs
  - shared: `constants/{levels,risk,audit,errors,features}.ts`, `risk.test.ts`, `types/{risk,badge,user,audit}.ts`, `schemas/common.ts`, `index.ts`
  - server: models `RiskProfile`, `Badge`, `User`, `PhishingSimulation`, `AuditLog`, `schemaOptions`; `audit.service.ts`, `routeRegistry.ts`, `routes.ts`, `app.ts`, `config/env.ts`; the test file list
  - desktop: `XPBar`, `LevelLadder`, `AchievementBadge` and `badgeMotifs`, `RiskChip`, `RiskBreakdown`, `EscalationList`, `Scoreboard`, `design/tokens/{levels,risk}.ts`, and the `EmployeeDashboard`, `AdminDashboard` and styleguide fixtures
- **Client Needs doc:** binary, not read. Requirements come from the task brief and are labelled here:
  - **G1** award XP and apply the five-tier ladder (Apprentice, Aware, Practitioner, Guardian, Defender)
  - **G2** automatically award a named badge on each module completion
  - **R1** dynamic per-employee risk profile from four weighted dimensions (K30 / B25 / S30 / E15), classified Low / Medium / High mapped to Green / Amber / Red
  - **R2** governance: elevated risk triggers a targeted review and notifies the security team; critical events (for example credential submission in a simulation) are logged auditably and escalated for management review
  - **R3** auditable, defensible logs of escalations and of the organisation's responses (ISO/IEC 27001:2022, NIST SP 800-50, CIS v8 Control 14)
  - **UC** Award Badge (extends Complete Learning Module); Update Risk Profile (included by Take Module Quiz, Take Final Assessment and Respond to Phishing Simulation); Trigger Governance Escalation (extends Respond to Phishing Simulation); Review Governance Escalations; View Employee Risk Profiles
- **Class UML used:** `Employee.totalXP`, `Employee.level`, Employee "earns" Badge (0..*), `Badge {name, moduleId, iconMotif}`, `RiskProfile {knowledgeScore, behaviouralScore, simulationScore, engagementScore, riskLevel, computeComposite(): int}`, PhishingSimulation «feeds» RiskProfile.
- **Baseline:** Phase 3 is being implemented in the working tree. This plan targets the **approved Phase 3 plan and ADR 0008**, not in-progress code. The Phase 3 names it depends on:
  - `LearningHooks`, `AttemptRecordedEvent`, `ModuleCompletedEvent`, `FinalTestPassedEvent`, `AttemptEffects`
  - `AppOptions.learningHooks`, `RouteDeps.learningHooks`
  - `QuizAttempt.{attemptNumber, endReason, correctCount, totalCount, moduleId}`
  - `UserProgress.{quizPassed, completedAt, exerciseAnswers}`
  - `curriculumFor`, `appendOnly` plugin, `learningFixtures`

  If any of these change during the Phase 3 review, section 8 must be rechecked.
- **UI constants checked:**
  - **Level thresholds.** The UI uses 0 / 300 / 900 / 2000 / 3500 (fixtures; comment "proposed, unconfirmed, D9"). `shared/levels.ts` has names only and no thresholds (U8 open). **No conflict; Phase 4 adopts the UI values (D4-2).**
  - **Risk bands.** I found no 0-39 / 40-69 / 70-100 constant anywhere in the repo, and `shared/risk.ts` has no bands (U7 open). The UI fixtures (72 High; 55 and 44 Medium; 28 Low) are consistent with those bands and with "higher = riskier". **No conflict; Phase 4 adopts them (D4-7).**
  - **Mismatch found: sub-score direction.**
    - In the fixtures, Knowledge and Engagement read "high = good", while Simulation and Behavioural read "high = bad". No single weighted formula reproduces the fixture composites.
    - Phase 4 fixes one direction: every sub-score is a risk score (D4-6). Phase 7 corrects the fixtures and labels.
  - **Mismatch found: escalation status and severity names.**
    - The UI `EscalationItem` uses status `open | in_review` and severity `critical | caution` ("Elevated").
    - The domain uses `open | acknowledged | resolved` and `elevated | critical`.
    - Mapping: `acknowledged` → "In review"; `elevated` → caution tone. The UI type changes in Phase 7. No change now.
  - **Badge motifs.** `badgeMotifs.ts` keys are the vocabulary for `iconMotif`. Phase 4 copies the list into shared as `BADGE_ICON_MOTIFS`. Phase 6 re-types the desktop map against it.

## 1. Scope and requirement map
| # | Item | Requirement |
|---|---|---|
| 1 | XP rules as a pure function over attempt facts; monotone projection on Employee (ADR 0009) | G1, Class UML `Employee.totalXP` |
| 2 | `LEVEL_THRESHOLDS`, `levelForXp`, `levelProgress` in shared | G1, playbook "thresholds in shared/" |
| 3 | Badge definitions, `badgeawards` (exactly once), badge seed (D3-21) | G2, UC Award Badge, UML "earns" |
| 4 | Risk model v1, pure and in shared: sub-scores, re-normalisation, bands (ADR 0010) | R1, CLAUDE.md risk engine, UML `computeComposite()` |
| 5 | RiskProfile persistence with `riskassessments` history | R1 ("dynamic"), R3 (defensible) |
| 6 | Recompute on every attempt (hook) and on reconcile | UC Update Risk Profile (included by Quiz and Final Assessment) |
| 7 | Escalation entity, triggers, state machine, response notes (ADR 0011) | R2, R3, UC Trigger / Review Governance Escalations |
| 8 | Critical-event entry point (no route; used by Phase 5 and the phishing flag) | R2 critical events, UC Escalate Restricted Access |
| 9 | Audit actions for risk and escalations; audit outbox | R3, CLAUDE.md "every risk escalation writes an immutable audit log entry" |
| 10 | Audit-log hash chain and `audit:verify` (ADR 0012) | R3 (defensible), ADR 0005 deferral |
| 11 | `/me/xp`, `/me/badges` | View Progress Dashboard, D3-18 |
| 12 | `/admin/risk-profiles`, `/admin/users/:userId/risk-profile` | UC View Employee Risk Profiles |
| 13 | `/admin/escalations[/:id]` (GET, PATCH), `/admin/audit-logs` (GET) | UC Review Governance Escalations, R3 |
| 14 | Learning-effects hooks implementation plus reconcile CLI and sweeper | ADR 0008 (idempotent, reconcilable) |

**Flagged as having no explicit requirement (recommended):**
- `compositeScore`, `coverage`, `modelVersion` and `rev` on RiskProfile (not in the UML)
- the minimum-evidence rule (D4-12)
- `managementReference`
- `retriggered` events
- the in-process sweeper
- the `RECONCILE_SWEEP_INTERVAL` env key
- `audit.integrity_checked` and `maintenance.reconcile_run` actions
- `idempotencyKey` on AuditLog

**Out of scope (deferred):**
- `/admin/badges` CRUD and `/admin/badges/summary`: Phase 7 (D4-5)
- admin KPIs and scoreboard aggregate: Phase 7
- `/me/dashboard`, `/me/progress`: Phase 6
- desktop wiring of any of this: Phase 6 (employee) and Phase 7 (admin)
- gate behaviour signals and gate XP: Phase 5
- phishing outcomes data model and routes: flag phase. Phase 4 defines only the Simulation scoring function and the critical-event entry point.
- OS notifications to admins: Phase 7. Email: Phase 10 at the earliest.
- external audit anchoring, DB role restriction, key rotation: Phase 10
- audit of admin reads (D4-21)
- remedial training assignment as the "targeted review": continuous-review flag or Phase 7 (D4-16)

## 2. XP and levels (ADR 0009)

### 2.1 Facts (server builds them; shared consumes them)
```ts
// shared/src/gamification/xp.ts
interface AttemptFact { attemptId: string; attemptNumber: number; endReason: AttemptEndReason;
                        score: number; passed: boolean }
interface ModuleXpFacts { moduleId: string; firstAttempt: AttemptFact | null;
                          passingAttempt: AttemptFact | null;      // first passed attempt
                          practiceFirstTryCorrect: number }        // exerciseAnswers with correct = true
interface XpFacts { modules: readonly ModuleXpFacts[]; finalTest: { firstAttempt: AttemptFact | null;
                    passingAttempt: AttemptFact | null } | null }
type XpSource = 'module_completion' | 'module_first_try' | 'module_perfect' | 'module_practice'
              | 'final_completion' | 'final_first_try' | 'final_perfect';
interface XpEntry { key: string; source: XpSource; amount: number; moduleId: string | null; attemptId: string }
computeXp(facts: XpFacts): { total: number; entries: XpEntry[] }   // entries sorted by key
xpEarnedForAttempt(result, attemptId): number
```
Rules (`XP_RULES`, frozen, in `shared/src/constants/gamification.ts`):

| Key | Source | XP | Condition |
|---|---|---|---|
| `module:<id>:completion` | module_completion | 150 | `passingAttempt` exists |
| `module:<id>:first_try` | module_first_try | 100 | `passingAttempt.attemptNumber === 1` |
| `module:<id>:perfect` | module_perfect | 50 | `passingAttempt.score === 100` |
| `module:<id>:practice` | module_practice | 10 × n | the module is passed; n = first-answer-correct exercises (0 → no entry) |
| `final:completion` | final_completion | 400 | final passed |
| `final:first_try` | final_first_try | 200 | passing final `attemptNumber === 1` |
| `final:perfect` | final_perfect | 100 | passing final score 100 |

All of a module's entries are attributed to its passing attempt, so `xpEarned` is complete on the
completion response.

**Invariants (tested):**
- Failed, abandoned and expired attempts earn nothing.
- Duplicate or reordered facts give the same result.
- With the seed curriculum the maximum is 7 × 300 + 170 + 700 = **2,970** (Guardian).

### 2.2 Levels
```ts
// shared/src/constants/levels.ts (change)
LEVEL_THRESHOLDS: Readonly<Record<Level, number>> = { Apprentice: 0, Aware: 300, Practitioner: 900, Guardian: 2000, Defender: 3500 }
// shared/src/gamification/levels.ts
levelForXp(xp: number): Level                 // highest level whose threshold <= xp; throws on negative or non-integer
levelProgress(xp: number): { level; tier: 1..5; currentLevelFloorXP; nextLevel: Level | null;
                             nextLevelXP: number | null; xpToNextLevel: number | null }
```
`levelProgress` produces exactly the props `XPBar` and `LevelLadder` take.

### 2.3 Persistence and idempotency
- **Projection.** `xp.service.recomputeXp(userId, {attemptId?})`:
  1. load the facts (QuizAttempts of the user, projected; UserProgress exercise answers)
  2. `computeXp`
  3. `Employee.updateOne(mongoose.trusted({ _id, role:'employee', totalXP: { $lt: T } }), { $set: { totalXP: T, level: levelForXp(T) } })`
  4. return `{ total: T, xpEarned }`
- **Monotone.** Facts only grow (attempts are append-only; passes are never revoked, ADR 0006), so any interleaving converges to the maximum.
- **Forced mode.** `--force-xp` (reconcile only) uses an unconditional `$set` for rule changes.
- **Unpublished or deleted modules.** Their passes still count (ADR 0006 §3).
- **Retries.** Unlimited retries cannot farm XP: completion keys exist once per module.
- **First attempt.** The first-try bonus uses `attemptNumber === 1` whatever its end reason (D4-3). Abandoning to preview questions forfeits the bonus.

## 3. Badges

### 3.1 Definitions
`Badge` is unchanged in shape. `iconMotif` is validated against `BADGE_ICON_MOTIFS` (shared, the 15
keys in `badgeMotifs.ts`) by the shared `badgeAuthoringSchema` (`name` 1..120, `iconMotif` enum). The
model adds `maxlength: 40` to `iconMotif`. The schema is reused by Phase 7.

Seed (`server/src/scripts/seed/badgeContent.ts`, keyed by module `order`; names avoid level names):

| Module (order) | Badge name | iconMotif |
|---|---|---|
| 1 Welcome to CSense | First Steps | `welcome` |
| 2 Passwords and authentication | Key Keeper | `password` |
| 3 Phishing | Phish Spotter | `phishing` |
| 4 Social engineering | Pretext Proof | `social-engineering` |
| 5 Safe browsing and downloads | Safe Clicker | `click` |
| 6 Protecting devices and data | Device Protector | `device` |
| 7 Reporting incidents | First Responder | `shield-check` |

`seedBadges(deps)` follows the same rules as D3-22:
- dev and test only; refuses production
- create-missing, keep-existing; a duplicate from a race counts as "kept"
- validated with `badgeAuthoringSchema`

`seed:learning` calls it after the modules. A standalone `seed:badges` script is added as well.

### 3.2 Awards (`badgeawards`, new, append-only)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| badgeId | ObjectId → Badge | required |
| moduleId | ObjectId → Module | required (denormalised) |
| attemptId | ObjectId or null | the passing attempt; null if retroactive with no attempt found |
| source | `completion` \| `reconcile` | required |
| awardedAt | Date | required (event `at`; for reconcile, `UserProgress.completedAt`) |

- **Indexes:** `{userId:1, badgeId:1}` unique; `{badgeId:1}`; `{userId:1, awardedAt:-1}`.
- **Immutability:** the Phase 3 `appendOnly` plugin.
- **`badges.service.awardForModule(userId, moduleId, attemptId, at)`:**
  - find the Badge by `moduleId`; if there is none, log `warn` and return null
  - `BadgeAward.create`
  - on duplicate key, read the existing award
  - return `{ id, name, iconMotif }`

## 4. Risk model v1 (ADR 0010; pure, `shared/src/risk/`)

### 4.1 Direction, constants and integer arithmetic
- Every sub-score and the composite are integers 0..100. **Higher means riskier.**
- Existing constants stay as they are: `RISK_WEIGHTS`, `RISK_LEVELS`, `RISK_LEVEL_TO_STATE`, `RISK_SCORE_MIN/MAX`.

New constants:
```ts
RISK_MODEL_VERSION = 1
RISK_WEIGHTS_BP = { knowledge: 3000, behavioural: 2500, simulation: 3000, engagement: 1500 } // = RISK_WEIGHTS x 10000
RISK_BANDS = [ { level:'Low', min:0, max:39 }, { level:'Medium', min:40, max:69 }, { level:'High', min:70, max:100 } ]
RISK_MIN_FIRST_ATTEMPTS = 2
CONDUCT_RETRY_ALLOWANCE = 3                     // extra failed submissions per assessment that saturate retryRate
BEHAVIOURAL_GROUP_WEIGHTS = { gate: 70, conduct: 30 }   // used from Phase 5 (model v2)
SIMULATION_OUTCOMES = ['reported','no_action','clicked_then_reported','clicked','credentials_submitted']
SIMULATION_OUTCOME_POINTS = { reported:0, no_action:25, clicked_then_reported:50, clicked:75, credentials_submitted:100 }
SIMULATION_WINDOW = 5
DIMENSION_COVERAGE = ['assessed','not_assessed','disabled']
```
`roundHalfUp(num, den)` = `floor((2*num + den) / (2*den))` for non-negative integers (`den > 0`). It is the only
rounding used.

### 4.2 Sub-scores (each returns `number | null`; null = not assessed)
| Dimension | Phase 4 source | Formula | Null when |
|---|---|---|---|
| Knowledge | first attempts (`attemptNumber === 1`) of every attempted quiz and the final test | `C = Σ correctCount`, `T = Σ totalCount`; `roundHalfUp(100(T−C), T)`; abandoned or expired first attempts count 0 correct of the served questions | no first attempt |
| Behavioural | **assessment conduct** (Phase 4); gate group from Phase 5 | n = attempts, a = abandoned + expired, m = assessments attempted, x = Σ max(0, failedSubmitted − 1) per assessment, R = 3m: `conduct = roundHalfUp(100(a·R + n·min(x,R)), 2·n·R)`. Behavioural = conduct (v1); v2 = `roundHalfUp(70·gate + 30·conduct, 100)` | n = 0 |
| Simulation | phishing outcomes (flag; empty in Phase 4) | last 5 outcomes by `occurredAt`: `roundHalfUp(Σ points, k)` | flag off (`disabled`) or no outcomes (`not_assessed`) |
| Engagement | current curriculum (published modules) plus the final test | `N = modules + (finalExists?1:0)`, `D = passed curriculum modules + (finalPassed?1:0)`: `roundHalfUp(100(N−D), N)` | N = 0 |

**Behavioural before Phase 5 (D4-9).** The only behaviour Phase 3 observes is how the employee
treats the secure quiz:
- leaving it (abandoned or expired; the kiosk exit)
- guessing loops (repeated failed submissions)

Timing is not used: QuizAttempt has no duration, and session start times are deleted by the TTL, so
timing would not be rebuildable. Phase 5 adds the gate group (failed first answers, restricted access,
lockdown escape attempts) and bumps the model to v2.

### 4.3 Composite, coverage, classification
```ts
// shared/src/risk/profile.ts
interface RiskFacts {
  attempts: readonly { assessmentId: string; kind: AssessmentKind; attemptNumber: number;
                       endReason: AttemptEndReason; passed: boolean; correctCount: number; totalCount: number }[];
  curriculum: { moduleIds: readonly string[]; passedModuleIds: readonly string[];
                finalTestExists: boolean; finalTestPassed: boolean };
  simulation: { enabled: boolean; outcomes: readonly { outcome: SimulationOutcome; occurredAt: string }[] };
  gate: null;                                    // Phase 5 widens this
}
interface RiskResult {
  modelVersion: number;
  scores: Record<RiskDimension, number | null>;
  coverage: Record<RiskDimension, DimensionCoverage>;
  effectiveWeightsBp: Record<RiskDimension, number>;   // 0 for excluded dims; display only; sums to 10000
  compositeScore: number | null; riskLevel: RiskLevel | null; assessed: boolean;
  evidence: { attempts; firstAttempts; abandoned; expired; extraFailures; passedModules;
              curriculumSize; finalTestPassed; simulationOutcomes };
}
computeComposite(scores, coverage): number | null   // roundHalfUp(Σ bp_i·s_i, Σ bp_i) over assessed dims
classifyRisk(composite: number): RiskLevel           // throws unless an integer in 0..100
computeRiskProfile(facts): RiskResult
riskStateFor(level): GovernanceState                 // via RISK_LEVEL_TO_STATE
```
**Rules:**
- **Assessed.** `assessed` iff Knowledge has first attempts on at least `min(RISK_MIN_FIRST_ATTEMPTS, N)` distinct assessments. Otherwise `compositeScore` and `riskLevel` are null; sub-scores are still returned.
- **Excluded dimensions** (not assessed or disabled) drop out, and the remaining **nominal** basis-point weights are re-normalised (D4-8).
- **Effective weights.** `effectiveWeightsBp` are rounded half-up with the remainder given to the largest weight, so they sum to 10000. With Simulation disabled they are K 4286 / B 3571 / S 0 / E 2143.
- **Bands.** 0–39 Low (Green), 40–69 Medium (Amber), 70–100 High (Red).

**Reference cases (become unit tests):**

| K | B | S | E | Composite | Level |
|---|---|---|---|---|---|
| 100 | 0 | 0 | 63 | 394500/10000 = 39.45 → **39** | Low |
| 100 | 38 | 0 | 0 | 39.5 → **40** | Medium |
| 100 | 38 | 100 | 0 | 69.5 → **70** | High |
| 100 | 0 | 100 | 63 | 69.45 → **69** | Medium |
| 100 | 0 | disabled | 0 | 300000/7000 = 42.86 → **43** | Medium |
| 100 | 25 | disabled | 88 | 494500/7000 = 70.64 → **71** | High (the crafted gate case, §12) |

### 4.4 Escalation decision (pure)
```ts
// shared/src/risk/transitions.ts
decideRiskTransition(prev: RiskLevel | null, next: RiskLevel | null):
  { levelChanged: boolean; direction: 'up' | 'down' | 'none';
    escalate: boolean;                  // next === 'High' && prev !== 'High'
    auditSeverity: 'info' | 'warning' }  // warning when direction is up, info when down
```

## 5. Risk persistence and recomputation

### 5.1 RiskProfile (`riskprofiles`, change)
| Field | Change | Rules |
|---|---|---|
| userId | unchanged | unique |
| knowledgeScore, behaviouralScore, simulationScore, engagementScore | **default `null`** (was 0) | int 0..100 or null (D4-23) |
| riskLevel | **default `null`** (was `Low`) | `Low` \| `Medium` \| `High` \| null |
| compositeScore | **new** (not in the UML; materialises `computeComposite()`) | int 0..100 or null |
| coverage | **new** | `{knowledge, behavioural, simulation, engagement}` ∈ DIMENSION_COVERAGE |
| effectiveWeightsBp | **new** | 4 ints |
| evidence | **new** | counts from `RiskResult.evidence` |
| modelVersion | **new** | int ≥ 1 |
| rev | **new** | int, default 0; optimistic-concurrency counter |
| lastAssessmentId | **new** | ObjectId → RiskAssessment or null |
| highEpisodeId | **new** | ObjectId → RiskAssessment that moved the profile into High; null when not High |
| computedAt | **new** | Date or null |

- **Indexes:** existing ones, plus `{compositeScore:-1}`.
- **Scope:** profiles exist only for `role: employee`. They are created lazily on the first recomputation.

### 5.2 RiskAssessment (`riskassessments`, new, append-only)
- **Fields:**
  - `userId`, `profileRev`, `modelVersion`
  - `scores` (4, nullable), `compositeScore`, `riskLevel`, `previousLevel`, `levelChanged`
  - `coverage`, `effectiveWeightsBp`, `evidence`
  - `inputsDigest`: SHA-256 hex of canonical `RiskFacts`
  - `trigger`: `{ type: 'attempt' | 'reconcile' | 'critical_event' | 'model_upgrade' | 'config_change', refId: ObjectId | null }`
  - `computedAt`
- **Written only when** a score, the coverage, the level or the model version changes, which bounds growth.
- **Indexes:** `{userId:1, computedAt:-1}`, `{levelChanged:1, computedAt:-1}`.
- **Immutability:** the `appendOnly` plugin.

### 5.3 When the profile is recomputed
| Trigger | Where | Trigger type |
|---|---|---|
| Every QuizAttempt (submitted, abandoned, expired; quizzes and final test) | `onAttemptRecorded` hook | `attempt` (refId = attemptId) |
| Reconcile CLI or sweeper | maintenance | `reconcile` |
| Model version change, `FEATURE_PHISHING` toggled, curriculum changed (Phase 7 publish, unpublish, reorder) | run `gamification:reconcile --all` | `model_upgrade` / `config_change` |
| Critical event (Phase 5 gate, phishing flag) | `governance.recordCriticalEvent` | `critical_event` |

Admin GETs never recompute; they read the stored profile.

### 5.4 `risk.service.recomputeForUser(userId, trigger)` algorithm
1. Load the profile (or treat it as `rev 0`, absent). Skip non-employees.
2. Load the facts (QuizAttempts projected; `curriculumFor(userId)`; passes; FinalTest existence and pass; simulation `{enabled: config.features.phishing, outcomes: []}`).
3. Compute `R = computeRiskProfile(facts)`. If R equals the stored state (scores, coverage, level, version), stop: no writes.
4. Pre-generate the assessment id `A`. Then `decideRiskTransition(profile.riskLevel, R.riskLevel)`.
5. **CAS:**
   - `findOneAndUpdate({userId, rev}, {$set: {...R, lastAssessmentId: A, computedAt, highEpisodeId: enteringHigh ? A : leavingHigh ? null : unchanged}, $inc: {rev: 1}})`
   - The first creation uses `create` with `rev: 1`, and a duplicate key counts as a conflict.
   - On conflict, go back to step 1 (at most 3 tries, then throw). Facts are always read after the profile, so the last successful writer used the freshest facts.
6. Insert `RiskAssessment A` (`trigger`, `previousLevel`, `inputsDigest`).
7. If `levelChanged`, write the `risk.level_changed` audit entry (`idempotencyKey: risk:<A>:level_changed`).
8. If `escalate`, call `escalations.openForRiskHigh(userId, A, context)` (§6.3).
9. Return R. Errors after step 5 are thrown to the caller (the hook adapter marks the user for reconcile, §8).

## 6. Governance escalation (ADR 0011)

### 6.1 Escalation (`escalations`, new)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | subject employee, required |
| reason | `risk_level_high` \| `simulation_credentials_submitted` \| `gate_access_restricted` | required; the last two have producers in the flag phase and Phase 5 |
| severity | `elevated` \| `critical` | required |
| reviewTier | `security_team` \| `management` | required |
| status | `open` \| `acknowledged` \| `resolved` | default `open` |
| active | Boolean | true while `open` or `acknowledged` (for the partial index) |
| dedupeKey | String ≤ 200 | `risk_level_high:<userId>:<assessmentId>` or `<reason>:<sourceType>:<sourceId>`; **unique** |
| context | `{ riskLevel, previousLevel, compositeScore, scores, coverage, riskAssessmentId, modelVersion }` (nullable parts) | snapshot at opening |
| sourceRef | `{ type: 'risk_assessment' \| 'phishing_event' \| 'gate_event', id: ObjectId }` | required |
| openedAt | Date | required |
| acknowledgedAt / acknowledgedBy, resolvedAt / resolvedBy | Date / ObjectId → User | nullable |
| assigneeId | ObjectId → User or null | set to the acknowledging administrator |
| resolution | `remediated` \| `risk_accepted` \| `false_positive` \| `no_action_required` \| null | |
| managementReference | String ≤ 200 or null | required to resolve on the `management` tier |
| events | `[{ eventId: ObjectId, type: 'opened' \| 'retriggered' \| 'acknowledged' \| 'note' \| 'resolved', at, actorId \| null, actorRole \| null, fromStatus \| null, toStatus \| null, note: String ≤ 2000 \| null, resolution \| null, refId \| null, audited: Boolean }]` | `_id:false`; maximum 200 (a note after 200 events → 409 `CONFLICT`) |
| version | int | default 0; `+1` on every change |

**Indexes:**
- `{dedupeKey:1}` unique
- `{userId:1, reason:1}` unique, partial `{active: true, reason: 'risk_level_high'}`
- `{status:1, severity:1, openedAt:-1}`
- `{userId:1, openedAt:-1}`
- `{'events.audited':1}`

Uses `strict: 'throw'` and timestamps.

### 6.2 State machine (pure, `shared/src/governance/escalation.ts`)
```ts
ESCALATION_ACTIONS = ['acknowledge', 'note', 'resolve'] as const
applyEscalationAction(status: EscalationStatus, action: EscalationAction):
  { ok: true; next: EscalationStatus } | { ok: false; reason: 'invalid_transition' }
```
| From \ action | acknowledge | note | resolve |
|---|---|---|---|
| open | → acknowledged | open | ✗ 409 `INVALID_STATE_TRANSITION` |
| acknowledged | ✗ 409 | acknowledged | → resolved |
| resolved | ✗ 409 | resolved | ✗ 409 |

Server-side rules beyond the table:
- `resolve` on the `management` tier without `managementReference` → 400 `VALIDATION_ERROR` (path `managementReference`).
- A stale `expectedVersion` → 409 `CONFLICT`.

### 6.3 Triggers and side effects
- **Into High** (§5.4 step 8) calls `openForRiskHigh`:
  - insert an escalation with `dedupeKey = risk_level_high:<userId>:<A>`, an `opened` event (`audited:false`), severity `elevated`, tier `security_team`
  - **duplicate key on the active partial index:** push a `retriggered` event (eventId = A, guarded by `events.eventId: {$ne: A}`) onto the active escalation, `$inc version`
  - **duplicate on `dedupeKey`:** already done, no-op
  - then audit each new event and set `events.$.audited = true`
  - then `notifier.escalationOpened(...)`
- **Into Medium:** audit only (`risk.level_changed`, warning). **Down:** audit (info); no change to any escalation (no auto-resolve).
- **Critical event:** `governance.recordCriticalEvent({ userId, reason, sourceRef, occurredAt, details })`:
  1. audit `governance.critical_event_recorded` (critical, target user, `idempotencyKey: critical:<reason>:<sourceId>`)
  2. insert an escalation (severity `critical`, tier `management`, `dedupeKey` from the source) plus its `opened` audit
  3. notify
  4. `risk.recomputeForUser(trigger critical_event)`

  It rejects reasons whose producer feature is off (`simulation_credentials_submitted` while `FEATURE_PHISHING` is false) with a programming error.

### 6.4 Admin transition (PATCH)
1. zod (strict discriminated union, §7).
2. Load by id → 404.
3. `applyEscalationAction`. If invalid → 409 `INVALID_STATE_TRANSITION`.
4. Tier check (management reference) → 400.
5. `findOneAndUpdate({_id, version: expectedVersion, status: from}, {$set: {...}, $push: {events: {..., audited:false}}, $inc: {version: 1}})`. If null, reload: a version mismatch → 409 `CONFLICT`; a status change → 409 `INVALID_STATE_TRANSITION`.
6. `audit.record` (actor = admin with role, target `escalation`, `idempotencyKey escalation:<id>:event:<eventId>`, metadata `{ from, to, resolution?, noteSha256?, noteLength?, managementReference? }`), then mark the event audited.
   - If the audit fails, respond **500 `INTERNAL_ERROR`**, write a reconcile marker and log `error`. The state change stands; the sweeper completes the audit (ADR 0011).
7. 200 `EscalationDetailDTO`.

`expectedVersion` is optional only for `note` (notes never conflict on state).

### 6.5 Notifying the security team
- **`SecurityTeamNotifier`** (`features/governance/notifier.ts`): `escalationOpened(e)`, `escalationRetriggered(e)`.
  - The Phase 4 implementation, `logNotifier`, logs at `warn` with `{event:'escalation.opened', escalationId, reason, severity, reviewTier}` (no names or emails).
  - Notifier errors are swallowed and logged; they never block.
- **In-app:** `GET /admin/escalations` always returns `counts: { open, acknowledged }` for the sidebar badge and KPI.
- **Phase 7:** admin console polling plus Electron native notifications. **Phase 10 at the earliest:** email behind SMTP config (D4-17).

## 7. Endpoints (Phase 4 inventory: 8 routes)
| # | Method | Path | Access | Query / body | Success | Errors |
|---|---|---|---|---|---|---|
| 1 | GET | `/me/xp` | `EMPLOYEE_ONLY` (self) | none | 200 `XpSummaryDTO` | 401, 403 |
| 2 | GET | `/me/badges` | `EMPLOYEE_ONLY` (self) | none | 200 `MyBadgesDTO` | 401, 403 |
| 3 | GET | `/admin/risk-profiles` | `ADMIN_ONLY` | `ListRiskProfilesQuery` | 200 `{ items: RiskProfileSummaryDTO[], page, pageSize, total }` | 400, 401, 403 |
| 4 | GET | `/admin/users/:userId/risk-profile` | `ADMIN_ONLY` | none | 200 `RiskProfileDetailDTO` | 400, 404 (unknown id or not an employee), 401, 403 |
| 5 | GET | `/admin/escalations` | `ADMIN_ONLY` | `ListEscalationsQuery` | 200 `{ items: EscalationSummaryDTO[], page, pageSize, total, counts: {open, acknowledged} }` | 400, 401, 403 |
| 6 | GET | `/admin/escalations/:escalationId` | `ADMIN_ONLY` | none | 200 `EscalationDetailDTO` | 400, 404 |
| 7 | PATCH | `/admin/escalations/:escalationId` | `ADMIN_ONLY` | `EscalationActionRequest` | 200 `EscalationDetailDTO` | 400, 404, 409 `INVALID_STATE_TRANSITION` / `CONFLICT`, 500 (audit failed, §6.4) |
| 8 | GET | `/admin/audit-logs` | `ADMIN_ONLY` | `ListAuditLogsQuery` | 200 `{ items: AuditLogDTO[], nextCursor: number \| null }` | 400 |

Notes:
- **`/me/badges` and `/me/xp`** take identity from the token only.
- **No `/me/risk`** (Phase 1 D17: employees never see their own risk; D4-22).
- **Audit logs are read-only by construction.** No other method is registered, so POST, PUT, PATCH and DELETE on `/admin/audit-logs[...]` return 404.
- **`/admin/badges`** stays in Phase 7 (D4-5).

### 7.1 Request schemas (`shared/src/schemas/{gamification,risk,governance,auditLogs}.ts`, all `.strict()`)
```ts
userIdParamsSchema       = { userId: objectIdSchema }
escalationParamsSchema   = { escalationId: objectIdSchema }
pageQuery                = { page?: z.coerce.number().int().min(1).max(10_000) (default 1),
                             pageSize?: z.coerce.number().int().min(1).max(100) (default 25) }
listRiskProfilesQuerySchema = pageQuery & {
  level?: z.enum(['Low','Medium','High','unassessed']),
  department?: z.string().trim().min(1).max(120),
  sort?: z.enum(['composite_desc','composite_asc','name_asc','computed_desc']) (default 'composite_desc') }
listEscalationsQuerySchema = pageQuery & {
  status?: z.enum(['open','acknowledged','resolved','active']),        // active = open + acknowledged
  severity?: z.enum(ESCALATION_SEVERITIES), reason?: z.enum(ESCALATION_REASONS),
  userId?: objectIdSchema }                                            // sort: severity desc, openedAt desc
noteSchema = z.string().trim().min(1).max(2000).refine(no control chars except \n and \t)
escalationActionRequestSchema = z.discriminatedUnion('action', [
  { action: 'acknowledge', expectedVersion: z.int().min(0), note?: noteSchema },
  { action: 'note',        expectedVersion?: z.int().min(0), note: noteSchema },
  { action: 'resolve',     expectedVersion: z.int().min(0), resolution: z.enum(ESCALATION_RESOLUTIONS),
                           note: noteSchema, managementReference?: z.string().trim().min(1).max(200) } ])  // each .strict()
listAuditLogsQuerySchema = {
  action?: z.enum(AUDIT_ACTIONS), severity?: z.enum(AUDIT_SEVERITIES), outcome?: z.enum(AUDIT_OUTCOMES),
  actorId?: objectIdSchema, targetType?: z.enum(AUDIT_TARGET_TYPES), targetId?: objectIdSchema,
  from?: z.iso.datetime(), to?: z.iso.datetime(),                      // refine from <= to
  before?: z.coerce.number().int().min(1),                             // seq cursor, exclusive
  limit?: z.coerce.number().int().min(1).max(200) (default 50) }
```
The query parser is `simple` (Phase 2), so every filter is single-valued. Arrays and `[$ne]` keys are
rejected by strict schemas.

### 7.2 Response schemas (`shared/src/schemas/*Responses.ts`, strict; DTO types are `z.infer`)
```ts
XpSummaryDTO   { totalXP, level: Level, tier: 1..5, currentLevelFloorXP, nextLevel: Level | null,
                 nextLevelXP: number | null, xpToNextLevel: number | null,
                 thresholds: Record<Level, number> }
BadgeProgressDTO { badgeId, name, iconMotif, moduleId, moduleTitle, position: number | null,
                   earned: boolean, earnedAt: string | null }
MyBadgesDTO    { items: BadgeProgressDTO[], earnedCount, totalCount }
   // items: badges of current curriculum modules in curriculum order, then earned badges of modules
   // outside the curriculum (position null). totalCount = items.length.
RiskScoresDTO  { knowledge, behavioural, simulation, engagement }: number | null each
RiskProfileSummaryDTO { userId, name, department: string | null, isActive,
                        compositeScore: number | null, riskLevel: RiskLevel | null,
                        governanceState: GovernanceState | null, scores: RiskScoresDTO,
                        coverage: Record<RiskDimension, DimensionCoverage>, computedAt: string | null }
RiskAssessmentDTO { id, computedAt, modelVersion, compositeScore, riskLevel, previousLevel,
                    levelChanged, scores, coverage, trigger: { type, refId: string | null } }
RiskProfileDetailDTO { profile: RiskProfileSummaryDTO & { modelVersion: number | null,
                         effectiveWeightsBp: Record<RiskDimension, number> | null,
                         nominalWeightsBp: Record<RiskDimension, number>, evidence: {...} | null },
                       history: RiskAssessmentDTO[]          // newest first, at most 20
                       escalations: EscalationSummaryDTO[] } // active ones plus the last 5 resolved
   // an employee with no profile yet → 200 with null scores and level, empty history
EscalationSummaryDTO { id, reason, severity, reviewTier, status,
                       subject: { userId, name, department: string | null },
                       riskLevel: RiskLevel | null, compositeScore: number | null,
                       openedAt, acknowledgedAt: string | null, resolvedAt: string | null,
                       assignee: { id, name } | null, version }
EscalationEventDTO { eventId, type, at, actor: { id, name, role } | null, fromStatus, toStatus,
                     note: string | null, resolution: string | null }
EscalationDetailDTO = EscalationSummaryDTO & { context: {...}, sourceRef: { type, id },
                       resolution: string | null, managementReference: string | null,
                       events: EscalationEventDTO[] }
AuditLogDTO (change) = existing fields + { seq: number | null, prevHash: string | null,
                       hash: string | null, idempotencyKey: string | null }
```
The Phase 3 `AttemptResultDTO.effects` (`{ xpEarned?, badge?: {id, name, iconMotif} }`) is unchanged.
`EmployeeDTO.totalXP` and `level` (from `/auth/me`) now carry real values.

### 7.3 Error codes
- New: `INVALID_STATE_TRANSITION` (409), with an `HttpError.invalidStateTransition()` factory.
- `CONFLICT` (409) gains a use for stale `expectedVersion`.

### 7.4 Audit actions and target types (`shared/src/constants/audit.ts`, change)
| Action | Severity | Target | Metadata (never note text, names or emails) |
|---|---|---|---|
| `risk.level_changed` | warning (up) / info (down) | user | `{from, to, compositeScore, riskAssessmentId, modelVersion, trigger}` |
| `escalation.opened` | warning (elevated) / critical | escalation | `{subjectUserId, reason, reviewTier, riskLevel, previousLevel, compositeScore, riskAssessmentId, modelVersion}` |
| `escalation.retriggered` | warning | escalation | `{subjectUserId, riskAssessmentId, compositeScore}` |
| `escalation.acknowledged` | info | escalation | `{eventId, from, to, noteSha256?, noteLength?}` |
| `escalation.note_added` | info | escalation | `{eventId, noteSha256, noteLength}` |
| `escalation.resolved` | info (warning when `risk_accepted`) | escalation | `{eventId, from, to, resolution, managementReference?, noteSha256, noteLength}` |
| `governance.critical_event_recorded` | critical | user | `{reason, sourceType, sourceId, occurredAt}` |
| `audit.integrity_checked` | info / critical when broken | null | `{ok, tipSeq, tipHash, checked, firstBreak?}` |
| `maintenance.reconcile_run` | info | null | `{scope, dryRun, counts}` |

`AUDIT_TARGET_TYPES` gains `escalation`.

## 8. Plugging into the hooks seam (ADR 0008)
**`server/src/features/effects/learningEffects.ts`:**
```ts
createLearningEffects(deps: { xp, badges, risk, markers, logger }): LearningHooks
  onAttemptRecorded(e)  → safe('risk', () => risk.recomputeForUser(e.userId, {type:'attempt', refId:e.attemptId})); return {}
  onModuleCompleted(e)  → badge = safe('badge', () => badges.awardForModule(e.userId, e.moduleId, e.attemptId, e.at))
                          xp    = safe('xp',    () => xp.recomputeXp(e.userId, {attemptId: e.attemptId}))
                          return { ...(xp ? {xpEarned: xp.xpEarned} : {}), ...(badge ? {badge} : {}) }
  onFinalTestPassed(e)  → xp = safe('xp', ...); return { xpEarned }
```
**`safe(kind, fn)`:**
- catches, then logs `error` with `{event:'learning_effect_failed', kind, userId, attemptId}`
- upserts a `reconcilemarkers` entry `{userId, reasons:$addToSet kind}`; a marker failure is only logged
- returns `undefined`

So one concern failing never drops the others, and the submission still returns 201 (ADR 0008).

**Wiring:**
- `createApp` defaults `learningHooks` to `createLearningEffects(...)` instead of noop. Tests still inject spies.
- Ordering is guaranteed by Phase 3: `onAttemptRecorded` (risk) runs before `onModuleCompleted`, and both run after the progress write, so Engagement already sees the pass.

**Reconcile (idempotent; `features/maintenance/reconcile.service.ts`):**
- `reconcileUser(userId, {dryRun, forceXp})`:
  1. **Badges:** every passed module with a Badge and no award → insert (`source: reconcile`, `awardedAt = completedAt`).
  2. **XP:** recompute; monotone (or forced) projection.
  3. **Risk:** `recomputeForUser(trigger reconcile)`. Then the invariants:
     - a profile at High whose `highEpisodeId` has no escalation with that `dedupeKey` → `openForRiskHigh`
     - `lastAssessmentId` missing → write a reconcile assessment
  4. **Audit outbox:**
     - every escalation event of the user with `audited:false` → write its audit entry by `idempotencyKey`, then mark it
     - every `levelChanged` RiskAssessment of the user without its audit key → write it
  5. Return a per-user diff.
- `reconcileAll` iterates employees with a cursor.
- **CLI** `gamification:reconcile [--user <id>] [--dry-run] [--force-xp] [--reason model_upgrade|config_change]`:
  - full env, allowed in production (an ops tool)
  - writes `maintenance.reconcile_run`
  - exit code 0, or 2 when drift was found in dry-run
- **Sweeper** (`features/maintenance/sweeper.ts`):
  - every `RECONCILE_SWEEP_INTERVAL` (default `5m`; `0` disables; tests call `sweepOnce()`)
  - claims markers with `findOneAndDelete` (oldest first, up to 50 per run) → `reconcileUser`; on failure re-upserts with `attempts+1`
  - also audits any escalation events with `audited:false` older than 1 minute
  - started from `index.ts` and stopped on shutdown, never from `createApp` in tests

## 9. Audit-log hash chain (ADR 0012)
**AuditLog (change):**
- New fields:
  - `seq` (int ≥ 1, **unique**)
  - `prevHash` (`^[0-9a-f]{64}$`)
  - `hash` (`^[0-9a-f]{64}$`)
  - `idempotencyKey` (String ≤ 200 or null; unique partial `{idempotencyKey: {$type: 'string'}}`)
- A `pre('validate')` on new documents requires `seq`, `prevHash` and `hash`.
- `insertMany` is now **blocked** (added to the immutability list).
- New index `{seq:1}` unique. The filtered reads use `{action:1, seq:-1}`, `{targetId:1, seq:-1}` and `{actorId:1, seq:-1}`, which are added.

**Code (`features/audit/chain.ts`, new):**
- `canonicalEntry(fields)`, `hmacHex(secret, canonical)`, `verifyChain(cursor, secret)`
- **`audit.record` becomes:**
  1. sanitise metadata (as today, plus Dates → ISO and a reject of non-JSON values)
  2. set `createdAt = clock()`
  3. under an in-process mutex (`lib/mutex.ts`): read the tip with `findOne(mongoose.trusted({seq:{$exists:true}})).sort({seq:-1})`; build `seq = tip.seq + 1` and `prevHash = tip.hash` (or 64 zeros); hash; `create`
  4. on E11000:
     - on `seq` → retry (at most 5)
     - on `idempotencyKey` → return the existing entry
  5. **Signature change:** it now returns `{ id, seq, duplicate }` instead of `void`; callers that ignore the value are unaffected.
- **`audit.service` takes `{ chainSecret, clock }`** through a factory `createAuditService(deps)`. The module-level `record` stays as a facade bound at app start, so Phase 2 call sites do not change.
- **CLI `audit:verify [--from <seq>]`:**
  - prints `{ ok, checked, tipSeq, tipHash, unchainedLegacy, firstBreak }`
  - exits 1 on a break
  - writes `audit.integrity_checked`

**Env:** `AUDIT_CHAIN_SECRET` (`generatedSecret`, distinct from the two JWT/refresh secrets: `superRefine`). Also required by the `bootstrap:admin`, `gamification:reconcile` and `audit:verify` scripts.

## 10. Configuration
| Key | Rule | Default |
|---|---|---|
| `AUDIT_CHAIN_SECRET` | generated secret (P2-L4 rules), ≠ other secrets | required, no default |
| `RECONCILE_SWEEP_INTERVAL` | `0` or `^\d+[smh]$` within 1m..1h | `5m` |

- These go into `AppConfig.audit.chainSecret` and `AppConfig.maintenance.sweepIntervalSeconds`.
- `testConfig` gets a random secret and sweep 0.
- `scrubEnv` must scrub `AUDIT_CHAIN_SECRET` from `process.env` like the other secrets.
- `.env.example` documents both keys (empty secret plus the generation command).

## 11. Files to create or change
**shared/**
- `src/constants/levels.ts` (change: `LEVEL_THRESHOLDS`, update the comment)
- `src/constants/risk.ts` (change: §4.1 constants; update the comment that "bands are U7")
- `src/constants/gamification.ts` (new: `XP_RULES`, `XP_SOURCES`, `BADGE_ICON_MOTIFS`)
- `src/constants/governance.ts` (new: `ESCALATION_REASONS`, `ESCALATION_SEVERITIES`, `ESCALATION_REVIEW_TIERS`, `ESCALATION_STATUSES`, `ESCALATION_ACTIONS`, `ESCALATION_EVENT_TYPES`, `ESCALATION_RESOLUTIONS`, `ESCALATION_NOTE_MAX=2000`, `ESCALATION_EVENTS_MAX=200`)
- `src/constants/audit.ts` (change: 9 actions, the `escalation` target type)
- `src/constants/errors.ts` (change: `INVALID_STATE_TRANSITION`)
- `src/gamification/{xp,levels,index}.ts` plus `xp.test.ts`, `levels.test.ts` (new)
- `src/risk/{math,knowledge,behavioural,simulation,engagement,composite,classify,profile,transitions,index}.ts` plus `risk.weights.test.ts`, `risk.bands.test.ts`, `risk.subscores.test.ts`, `risk.profile.test.ts`, `risk.transitions.test.ts` (new)
- `src/governance/{escalation,index}.ts` plus `escalation.test.ts` (new)
- `src/schemas/{gamification,risk,governance,auditLogs,badgeAuthoring}.ts` and `*Responses.ts` plus `phase4.schemas.test.ts` (new)
- `src/types/{risk,badge,audit}.ts` (change), `src/types/{gamification,governance}.ts` (new)
- `src/index.ts` (change: exports)
- `src/constants/risk.test.ts` (keep; extend or move into `risk.weights.test.ts`)

**server/**
- `src/models/BadgeAward.ts`, `RiskAssessment.ts`, `Escalation.ts`, `ReconcileMarker.ts` (new)
- `src/models/RiskProfile.ts`, `AuditLog.ts`, `Badge.ts`, `index.ts` (change)
- `src/features/gamification/{xpFacts.service,xp.service,badges.service,gamification.routes,gamification.mapper}.ts` (new)
- `src/features/risk/{riskFacts.service,risk.service,risk.routes,risk.mapper}.ts` (new)
- `src/features/governance/{escalation.service,criticalEvents.service,notifier,escalations.routes,escalation.mapper}.ts` (new)
- `src/features/audit/{chain,auditLogs.routes,audit.mapper}.ts` (new); `audit.service.ts` (change: chain, idempotency, factory)
- `src/features/effects/learningEffects.ts` (new)
- `src/features/maintenance/{reconcile.service,sweeper}.ts` (new)
- `src/lib/mutex.ts` (new); `src/lib/httpError.ts` (change)
- `src/routes.ts` (change: 3 route groups; deps), `src/app.ts` (change: default hooks, audit service deps), `src/index.ts` (change: sweeper lifecycle, audit facade binding)
- `src/config/env.ts`, `appConfig.ts`, `scrubEnv.ts` (change)
- `src/scripts/reconcileGamification.ts`, `verifyAudit.ts`, `seedBadges.ts`, `seed/badgeContent.ts` (new); `seedLearning.ts`, `bootstrapAdmin.ts` (change: call `seedBadges`; chain secret)
- `package.json` (scripts: `seed:badges[:dev]`, `gamification:reconcile[:dev]`, `audit:verify[:dev]`; **no new dependencies**, since `node:crypto` covers HMAC and SHA-256)

**server/test/**
- `helpers/testConfig.ts` (change: chain secret, sweep 0)
- `helpers/riskFixtures.ts` (new):
  - `insertAttempts(userId, spec)`: direct `QuizAttempt.create` with sessions
  - `craftHighRiskEmployee()`
  - `seedBadgesFor(curriculum)`
  - `verifyAuditChain()`
  - `auditEntriesFor(targetId)`
- `auditLog.test.ts` (change: AU3 now asserts `insertMany` is **blocked**; fixtures go through the service)
- `models.indexes.test.ts` (change: new collections and indexes)
- `env.test.ts`, `scrubEnv.test.ts` (change: the new secret)
- `rbac.denyByDefault.test.ts` (change: §12)
- new suites as listed in §12

**desktop/**: no change (Phase 6 and Phase 7).

**docs/** (implementer):
- `api/contract.md`: the 8 routes with DTO names; the `/me/badges` phase; `/admin/badges` → 7; `INVALID_STATE_TRANSITION`; `CONFLICT` widened; "System-triggered use cases" now names the critical-event service and the outbox
- `architecture/data-model.md`: §3.2, §5, §6.1, §9; `badgeawards` replaces the "Employee earns Badge: not stored yet" row
- `.env.example`; README (reconcile, verify, seed:badges)
- ADR 0005 consequence note pointing to ADR 0011 and 0012; ADR 0009–0012 status → Accepted

## 12. Tests
All server tests use mongodb-memory-server, the injected clock, and strict response-schema parsing.
Shared tests are pure.

**Unit (shared)**
- **`risk.weights.test.ts`**
  - RW1: `RISK_WEIGHTS` deep-equals `{knowledge:0.3, behavioural:0.25, simulation:0.3, engagement:0.15}`; frozen
  - RW2: `RISK_WEIGHTS_BP` deep-equals `{3000,2500,3000,1500}`, sums to 10000, and equals `round(RISK_WEIGHTS × 10000)` per key
  - RW3: with all four assessed, a single dimension at 100 and the others at 0 gives composite exactly 30 / 25 / 30 / 15. This proves each weight inside the formula.
  - RW4: all four equal to x gives x, for every x in 0..100
  - RW5: Simulation disabled → K-only 100 = 43, B-only 100 = 36, E-only 100 = 21; `effectiveWeightsBp` = `{4286, 3571, 0, 2143}`
  - RW6: monotonicity property: raising any assessed sub-score never lowers the composite (random 10,000 cases, seeded)
- **`risk.bands.test.ts`**
  - RB1: `classifyRisk` maps 0, 39 → Low; 40, 69 → Medium; 70, 100 → High
  - RB2: it throws for −1, 101, 39.5, NaN and `'40'`
  - RB3: every integer in 0..100 maps to exactly one band; the bands are contiguous and cover 0..100
  - RB4: the four half-up boundary cases in the §4.3 table (39, 40, 70, 69)
  - RB5: `RISK_LEVEL_TO_STATE` Low/Medium/High → Green/Amber/Red; `riskStateFor` agrees
  - RB6: the UI fixture composites 72 / 55 / 44 / 28 classify High / Medium / Medium / Low
- **`risk.subscores.test.ts`**
  - KN1: 5/5 + 15/15 → 0; 0/5 → 100; 3/5 + 12/15 → `round(100·5/20)` = 25
  - KN2: only `attemptNumber 1` counts (a later pass does not change it)
  - KN3: an abandoned first attempt with `totalCount 5` → 0 of 5
  - KN4: no attempts → null
  - BH1: no attempts → null; 4 submitted passes → 0
  - BH2: 2 abandoned of 4 with no extra failures → 25
  - BH3: one assessment with 4 failed submissions (3 extra) → retryRate 1 → 50; 10 extra → still 50 (saturation)
  - BH4: an exact-fraction case that hits .5 rounds up
  - SM1: flag off → null and `disabled`; on with no outcomes → null and `not_assessed`
  - SM2: points table; only the last 5 by `occurredAt` count
  - SM3: `credentials_submitted` alone → 100
  - EN1: 7 modules + final, 0 passed → 100; 7 passed and not final → 13 (12.5 rounds up); all → 0
  - EN2: no curriculum and no final → null
  - EN3: passes on unpublished modules are ignored
- **`risk.profile.test.ts`**
  - RP1: not assessed with 1 first attempt (N ≥ 2), assessed with 2; N = 1 → assessed with 1
  - RP2: the crafted gate case (K 100, B 25, S disabled, E 88) → 71 High
  - RP3: the result is independent of the input order of attempts
  - RP4: `modelVersion === 1`; `evidence` counts are exact
  - RP5: output scores are always integers in 0..100 or null (property test)
- **`risk.transitions.test.ts`**
  - RT1: the full 4×4 table over `{null, Low, Medium, High}`: `escalate` is true only for `* → High` where `* ≠ High`; `auditSeverity` is warning when the level goes up, info when it goes down; `levelChanged` is false on the diagonal
- **`levels.test.ts`**
  - LV1: `LEVEL_THRESHOLDS` deep-equals `{0, 300, 900, 2000, 3500}`; keys equal `LEVELS` in order; strictly increasing; first = 0; frozen
  - LV2: `levelForXp`: 0, 299 → Apprentice; 300, 899 → Aware; 900, 1999 → Practitioner; 2000, 3499 → Guardian; 3500, 10^6 → Defender
  - LV3: −1, 1.5 and NaN throw
  - LV4: `levelProgress(1240)` = Practitioner, floor 900, next Guardian 2000, 760 to go (screens.md example); `levelProgress(4100)` has `nextLevel` null
- **`xp.test.ts`**
  - XP1: first-try perfect module with 4 correct practice answers → 150 + 100 + 50 + 40 = 340
  - XP2: pass on attempt 2 with 80 and no practice → 150
  - XP3: abandoned attempt 1, then a 100 pass on attempt 2 (no practice) → 150 + 50 (no first-try bonus)
  - XP4: 1 failure + pass equals 100 failures + pass
  - XP5: an unpassed module (with correct practice) → 0
  - XP6: duplicated facts give the same total; entry keys are unique
  - XP7: final first-try perfect → 700
  - XP8: the full seed maximum is 2970 → `levelForXp` = Guardian
  - XP9: `xpEarnedForAttempt` sums only the entries of that attempt
  - XP10: shuffling the input gives an identical result
- **`escalation.test.ts`**
  - ES1: the full 3×3 table in §6.2
  - ES2: the action, status and resolution lists are exact
- **`phase4.schemas.test.ts`**
  - SC1: the PATCH union rejects an unknown action, `resolve` without a note, an extra `status` field, a note of 2001 characters, `expectedVersion −1` and `__proto__`
  - SC2: the list queries coerce and bound `page`, `pageSize`, `limit` and `before`; reject an unknown parameter; reject `from > to`
  - SC3: response schemas reject an extra field (for example `passwordHash` or `email` on the subject)
  - SC4: `badgeAuthoringSchema` rejects an unknown motif and an empty name

**Integration (server/test)**

XP expectations below use modules without exercises (seed module 1, or a fixture curriculum with
`exercises: 0`) unless practice XP is stated explicitly.
- **`models.phase4.test.ts`**
  - MP1: `BadgeAward` duplicate `{userId, badgeId}` → E11000; append-only on every blocked path
  - MP2: `RiskAssessment` is append-only
  - MP3: `Escalation` has a second active `risk_level_high` for the same user → E11000; resolved plus a new active one is allowed; the `dedupeKey` is unique
  - MP4: `RiskProfile` defaults are null and it rejects 101 and 1.5
- **`auditChain.test.ts`**
  - AC1: three `record()` calls → seq 1, 2, 3; genesis `prevHash` is zeros; links hold; `verifyChain` is ok; `createdAt` stored equals the hashed value
  - AC2: 50 concurrent `record()` → seq 1..50 with no gaps; verify ok
  - AC3: a driver-level `updateOne` of metadata on seq 7 → verify reports `hash_mismatch` at 7
  - AC4: a driver-level delete of seq 10 → `gap` at 10; a swap of two hashes → `link_mismatch`
  - AC5: the same `idempotencyKey` twice → one entry, the second returns `duplicate: true`, and no seq is consumed
  - AC6: `AuditLog.create` without chain fields fails; `insertMany` throws `AUDIT_LOG_IMMUTABLE`
  - AC7: verification with a different secret fails at seq 1
  - AC8: Date and nested metadata are canonicalised (key order does not change the hash; recomputation matches)
  - AC9: a competing writer (a second service instance with its own mutex) interleaves → still dense and valid (exercises the E11000 retry)
- **`gamification.award.test.ts`**
  - GA1: passing module 1 at 5/5 on the first attempt → 201 with `effects.xpEarned === 300` and `effects.badge` (name "First Steps", motif `welcome`); the Employee has `totalXP 300` and `level 'Aware'`; one BadgeAward
  - GA2: replaying the same body → 409; totals and award count unchanged
  - GA3: two concurrent submits on one session → one 201; one award; XP 300
  - GA4: calling the real hooks twice with the same `ModuleCompletedEvent` (redelivery) → one award, XP unchanged, the same `xpEarned` both times
  - GA5: 5 failed attempts then a pass at 80 → `xpEarned 150`; no XP on the failed attempts' responses
  - GA6: abandon then pass at 100 → 200 (no first-try bonus)
  - GA6b: a module with 4 exercises, 3 answered correctly on the first try, passed first try at 80 → `xpEarned 280` (150 + 100 + 30)
  - GA7: a module without a Badge → `effects` has `xpEarned` only; a warning is logged; after the badge is seeded, reconcile awards it with `awardedAt = completedAt` and `source: 'reconcile'`
  - GA8: passing the final test adds the final XP; `onFinalTestPassed` gives no badge
- **`me.gamification.test.ts`**
  - MG1: `/me/xp` before any pass → 0 Apprentice, next Aware 300, thresholds exact
  - MG2: `/me/badges` lists 7 in curriculum order, 0 earned, then 1 earned with `earnedAt` after passing module 1
  - MG3: employees A and B: A's pass never appears in B's `/me/badges` or `/me/xp`
  - MG4: an earned badge of an unpublished module stays listed with `position: null`
  - MG5: an admin token → 403; no token → 401; an unknown query parameter → 400
- **`risk.recompute.test.ts`**
  - RR1: after each attempt the stored profile equals `computeRiskProfile(facts)` from the DB
  - RR2: one first attempt → `riskLevel null`; two → classified
  - RR3: a RiskAssessment is written only when something changed (an identical recomputation writes nothing)
  - RR4: 5 concurrent `recomputeForUser` with interleaved attempt inserts → the final profile equals the pure result on the final facts; `rev` equals the number of successful writes
  - RR5: an administrator never gets a profile
  - RR6: `FEATURE_PHISHING` off → `coverage.simulation === 'disabled'`; on → `not_assessed`; a reconcile after the toggle records `config_change`
- **`governance.escalation.test.ts`**
  - GE1: a crafted high-risk profile → exactly one open `risk_level_high` escalation (elevated, `security_team`) with a context snapshot; the audit entries `risk.level_changed` (warning) and `escalation.opened` exist, with `targetId` = the escalation id; `verifyChain` ok; the notifier spy was called once
  - GE2: a further recomputation while still High → no new escalation, no new audit
  - GE3: High → Medium → High while active → one escalation with a `retriggered` event plus an `escalation.retriggered` audit
  - GE4: after a resolve, a new entry into High → a second escalation
  - GE5: Low → Medium → an audit entry only, no escalation
  - GE6: `recordCriticalEvent(gate_access_restricted)` → a critical, `management` escalation plus `governance.critical_event_recorded` and `escalation.opened` (both critical); the same source twice → one escalation
  - GE7: `simulation_credentials_submitted` with the flag off → throws; with the flag on → an escalation
  - GE8: escalation and audit failure in the hook path (audit service stubbed to throw) → the submission is still 201; the event has `audited:false`; a marker exists; `sweepOnce()` → the audit is written and the event is marked
- **`escalation.workflow.test.ts`**
  - EW1: acknowledge → 200, `acknowledged`, assignee = the admin, `version+1`, an `escalation.acknowledged` audit with the admin as actor
  - EW2: resolve with a resolution and a note → `resolved`, `active:false`; the audit metadata has `noteSha256` matching the note and **no note text**
  - EW3: resolve from `open` → 409 `INVALID_STATE_TRANSITION`; acknowledging twice → 409
  - EW4: a stale `expectedVersion` → 409 `CONFLICT`, with no state change and no audit
  - EW5: two concurrent acknowledges → exactly one 200 and one 409; one audit entry
  - EW6: a `management` tier resolve without `managementReference` → 400 with the path; with it → 200
  - EW7: a note on a resolved escalation → 200 plus `escalation.note_added`
  - EW8: the audit write fails during PATCH → 500; the state changed with `audited:false`; `sweepOnce` audits it exactly once (a rerun does not duplicate)
  - EW9: every event of every escalation in the suite has exactly one audit entry (invariant check)
- **`admin.risk.test.ts`**
  - AR1: list sorted by composite descending; `level=High`, `level=unassessed` and `department` filters; pagination and `total`
  - AR2: detail with history (newest first, at most 20) and escalations
  - AR3: an employee without a profile → 200 not assessed; an administrator id → 404; an unknown id → 404; an invalid id → 400
  - AR4: response schemas strict; no `passwordHash` or `email`
- **`admin.auditLogs.test.ts`**
  - AL1: filters by action, severity, `targetId` and the `from`/`to` range; `before` cursor paging is dense and ordered by seq descending; `limit` 0 and 201 → 400
  - AL2: POST, PUT, PATCH and DELETE on `/admin/audit-logs` and `/admin/audit-logs/:id` → 404
  - AL3: no item contains a key matching `/pass|token|secret/` or a note text
- **`reconcile.test.ts`**
  - RC1: drift injected through the driver (award deleted, `totalXP` set to 0, escalation deleted for a High profile, an audit outbox flag reset) → `reconcileUser` restores all four; a second run reports zero changes
  - RC2: `--dry-run` reports and changes nothing (no writes, including audit)
  - RC3: `--force-xp` lowers XP when the rules (injected) lower it; the default mode never lowers it
  - RC4: a hook failure (risk service stubbed to throw once) → 201 with `xpEarned` and `badge` still present; a marker exists; `sweepOnce` clears it and the profile is correct
  - RC5: the CLI writes `maintenance.reconcile_run`
- **`rbac.denyByDefault.test.ts`** (change)
  - B1: the inventory gains the 8 rows with their access
  - B2: 401 without a token on all of them
  - B3: an employee token → 403 on all 6 admin routes (every method)
  - B7: an admin token → 403 on `/me/xp` and `/me/badges`
  - New **B8**: an employee hitting `/admin/users/<other employee id>/risk-profile`, `/admin/escalations/<real id>` (GET and PATCH) and `/admin/audit-logs?targetId=<self>` → 403 with no body data, and the escalation is unchanged

**The Phase 4 gate: `server/test/gamification.journey.test.ts`** (uses the real seed with badges, a real employee and admin login, and real HTTP)
1. **Weights and bands:** the shared suites RW1–RW5 and RB1–RB4 are part of `npm test` (the gate's unit half).
2. **Completing a module awards XP and a badge:** employee E1 completes module 1's content (video, no exercises), starts the quiz and submits 5/5 → `effects.xpEarned 300` and `effects.badge.name 'First Steps'`; `GET /me/xp` → 300 Aware; `GET /me/badges` → 1 of 7 earned.
3. **Exactly once:** replay → 409; `/me/xp` still 300; the award count is still 1; calling the hooks again directly does not change totals.
4. **Retries do not farm:**
   - E1 answers module 2's 4 exercises with exactly 2 correct first answers and completes its content.
   - E1 fails the module 2 quiz three times, then passes at 80 → `xpEarned 170` (150 completion + 2 × 10 practice; total 470).
   - The failed responses carry no `xpEarned`.
5. **A crafted high-risk profile produces an escalation and an audit record:** employee E2 does the following:
   - abandons module 1's first session
   - fails it at 1/5
   - passes it at 4/5
   - completes module 2's content (answers its exercises; required before a session), then abandons module 2's first session

   The profile is then K 100, B 25, S disabled, E 88 → composite 71 High. The admin calls `GET /admin/escalations?status=active` → one `risk_level_high`, `elevated` escalation for E2, and `GET /admin/audit-logs?targetId=<escalationId>` → `escalation.opened`. `GET /admin/users/E2/risk-profile` shows 71, High and Red, with `coverage.simulation 'disabled'`.
6. **Response trail:** the admin acknowledges, then resolves with a note → two more audit entries; `verifyAuditChain()` is ok over the whole run.
7. **Authorization:** E1's token on every admin route → 403.

## 13. Implementation sequence
1. Merge Phase 3 to `main`. Cut `phase-04-gamification-risk`. Re-read the Phase 3 hook and attempt names against §0.
2. **Shared constants and pure logic:** levels, gamification, risk, governance, audit actions, error code. Write the unit suites (§12) first, then the functions until they pass.
3. **Shared schemas** (request, response, authoring) with tests; types and exports.
4. **Audit chain:** env, appConfig and scrubEnv; AuditLog fields, guards and indexes; `chain.ts`; `mutex.ts`; the `audit.service` factory and facade; `audit:verify`. Update the Phase 2 audit tests (AU3) and run every Phase 2 suite. The chain is under all later work, so it lands first.
5. **Models:** BadgeAward, RiskAssessment, Escalation, ReconcileMarker; the RiskProfile and Badge changes; model and index tests.
6. **Services:** xp facts and xp, badges, risk facts and risk, escalation and critical events, notifier. Then `learningEffects` and the `createApp` default.
7. Routes (8), mappers, `routes.ts`; the RBAC inventory, B3, B7 and B8.
8. Reconcile service, sweeper (`index.ts` lifecycle), the CLIs; badge seed and the `seedLearning` call.
9. Integration suites, then the gate journey.
10. **Docs:** contract, data model, `.env.example`, README; ADR 0005 note; ADR statuses.
11. **Definition of Done:** `lint`, `typecheck`, `test`, `build`, `format:check`, `npm audit --audit-level=high`. Then a PR, and a security-tester review focused on §14 risks 1–4 and the B8 authz sweep.

## 14. Risks
1. **Audit chain serialisation.**
   - Every audited event, including failed logins, now does a tip read plus an insert under a mutex, so bursts queue. Several instances or a concurrent CLI contend and retry (AC9).
   - A Mongoose `timestamps` quirk that overwrites a supplied `createdAt` would break every hash (AC1 guards it).
   - Mitigations: small critical section, bounded retries; measure login p95 before and after.
2. **Outbox lag and visible 500s.** An audit failure leaves a state change unaudited until the sweeper runs, and an admin can see a 500 for a change that happened. Mitigations: EW8 and GE8, the invariant test EW9, and a sweeper default of 5 minutes. The detail view shows the true state.
3. **Defensibility of the formulas.** Conduct, Engagement and the minimum-evidence rule are product judgements, not validated models, and re-normalisation gives Knowledge ~43% while Simulation is off.
   - Mitigations: named constants, a version on every score, coverage and effective weights shown, a full input digest on every history entry.
   - The product owner must approve D4-8 to D4-12.
4. **Alert fatigue or under-alerting.** "Into High only" may miss deteriorating employees who stay Amber, while "Into Medium" would flood during roll-out. The decision is D4-13; the trigger table is one function.
5. **Personal data.** Risk profiles and escalation notes are sensitive HR-adjacent data (GDPR, ISO A.5.34).
   - Admin-only, IDOR-tested; notes are never in audit metadata or logs.
   - Admin reads are not audited (D4-21); retention is undecided (Phase 10).
6. **Hook latency.** A submission now runs a risk recompute (attempt history, curriculum, CAS, possible audit and escalation writes) plus XP and badge. Expect +10–40 ms; acceptable at CSense scale, to be measured in the journey test.
7. **Phase 3 drift.** This plan depends on Phase 3 names (§0). If the Phase 3 review changes hook payloads or `AttemptEffects`, §8 and GA1–GA8 change with it.
8. **No transactions** (as D3-23). Every multi-write path is ordered, idempotent and reconcilable; partial states are repaired by the sweeper or CLI, never by guessing.
9. **Legacy unchained entries.** Phase 2 audit rows in development databases have no `seq`. The verifier reports them as `unchainedLegacy`; the chain starts at the first Phase 4 write. Production has none.
10. **Fixture and UI mismatches** (sub-score direction, escalation status names): no runtime impact now. They must be fixed when Phase 7 wires the console, or admins will misread the bars.
11. **The behavioural proxy can be gamed** by never abandoning or retrying, which means simply taking the quiz properly. That is acceptable: the signal rewards the intended behaviour. Phase 5 adds gate signals.
12. **Secret handling.** A third secret, `AUDIT_CHAIN_SECRET`: losing it makes the chain unverifiable; leaking it allows forging. Store it like the JWT secrets. Rotation is in Phase 10.

## 15. Not requirement-backed (flagged for approval)
- `compositeScore`, `coverage`, `effectiveWeightsBp`, `evidence`, `modelVersion`, `rev`, `highEpisodeId` on RiskProfile
- the `riskassessments` history (derived from R3 "defensible")
- the minimum-evidence rule
- `retriggered` events
- `managementReference`
- the reconcile sweeper and `RECONCILE_SWEEP_INTERVAL`
- `audit.integrity_checked` and `maintenance.reconcile_run`
- `idempotencyKey` on AuditLog
- `BADGE_ICON_MOTIFS` validation
- the practice XP source

## 16. Unchanged decisions reused
- U5 (one badge per module), U1 (Employee discriminator)
- D3-12 (unlimited retries), D3-19 (no learning audit actions), D3-22 (seed semantics), D3-23 (no transactions), D3-24 (hook failure semantics)
- ADR 0005 registry and validation; ADR 0006 (passes never revoked); Phase 1 D17 (employees do not see their own risk)

## 17. Decisions needed (recommended default in bold; each can be approved as is)
1. **D4-1 XP sources and amounts.** **Table in §2.1 (completion 150, first try +100, perfect +50, practice 10 each, final 400/200/100). The course maximum is 2,970 (Guardian); Defender needs Phase 5 or flag behaviour XP.** Alternative: scale the values so a perfect course run reaches Defender.
2. **D4-2 Level thresholds.** **Adopt the Phase 1 proposal 0 / 300 / 900 / 2000 / 3500 (closes U8/D9).**
3. **D4-3 "First attempt".** **`attemptNumber === 1` whatever the end reason, for both the first-try bonus and Knowledge (abandoning forfeits; stops question previewing).** Alternative: the first *submitted* attempt (friendlier, but gameable).
4. **D4-4 Badges.**
   - **One per module, with the seed names and motifs in §3.1**
   - **no final-test badge**
   - **awards permanent and stored in `badgeawards`**
   - **retroactive awards by reconcile**
5. **D4-5 `/admin/badges`.** **Phase 7, with module authoring (production badges arrive with production modules); Phase 4 ships the shared authoring schema and the dev seed.**
6. **D4-6 Sub-score direction.** **All four sub-scores and the composite are risk scores (0 = best, 100 = worst); Phase 7 relabels the bars and fixes the fixtures.** Alternative: proficiency-style Knowledge and Engagement inverted inside the formula.
7. **D4-7 Bands.** **0–39 Low, 40–69 Medium, 70–100 High on an integer composite rounded half up.**
8. **D4-8 Missing dimensions.** **Exclude and re-normalise the nominal weights, with per-dimension coverage flags (`disabled` for Simulation while `FEATURE_PHISHING` is off).** Alternatives: a neutral 50 (adds a constant 15 points to everyone), or zero (forbidden: treats as perfect).
9. **D4-9 Behavioural before Phase 5.** **Assessment conduct: (abandon + expiry rate + saturating extra-failure rate) / 2; Phase 5 blends gate 70 / conduct 30 (model v2).** Alternative: Behavioural `not_assessed` until Phase 5.
10. **D4-10 Knowledge.** **Question-weighted accuracy over first attempts (the final test counts 15 questions).**
11. **D4-11 Engagement.** **Share of the current curriculum plus the final test not completed; no time decay until Phase 7 due dates.**
12. **D4-12 Minimum evidence.** **Classified only after first attempts on 2 assessments (or all of them if fewer exist); before that, "Not assessed".**
13. **D4-13 Escalation triggers.** **Entering High → `elevated`, `security_team` review; critical events → `critical`, `management` tier; entering Medium → audit only.** Alternative: also escalate on Medium (as the Phase 1 fixture "Risk rose to Medium" suggests).
14. **D4-14 Dedupe.** **One active risk escalation per employee; re-entry appends `retriggered`; leaving High never auto-resolves.**
15. **D4-15 State machine.** **open → acknowledged → resolved; notes in any state; no reopen; a resolution is required; `management` tier needs `managementReference`.**
16. **D4-16 "Targeted review".** **The security team reviews the employee through the escalation; assigning remedial training is deferred to continuous review (flag) or Phase 7.**
17. **D4-17 Notification.** **Phase 4: in-app (escalation counts) plus a structured warn log; Phase 7: Electron OS notification in the admin console; email not before Phase 10 and only with SMTP config.**
18. **D4-18 Audit hash chain.** **Implement now: HMAC-SHA256 chain with a dense `seq`, `AUDIT_CHAIN_SECRET`, `insertMany` blocked, `audit:verify` CLI; external anchoring and key rotation in Phase 10 (ADR 0012).**
19. **D4-19 Escalation audit ordering.** **Outbox: the state change and the pending event are atomic, then the audit entry by idempotency key; on failure the PATCH returns 500 and the sweeper completes it. This amends the "audit first" sentence in ADR 0005 (ADR 0011).** Alternative: run MongoDB as a replica set and use transactions everywhere.
20. **D4-20 Reconciliation.** **`gamification:reconcile` CLI plus an in-process sweeper every 5 min (`RECONCILE_SWEEP_INTERVAL`).**
21. **D4-21 Auditing admin reads.** **Not in Phase 4** (reads of risk profiles and audit logs are not logged). Alternative: add an `audit.logs_viewed` / `risk.profile_viewed` info entry now.
22. **D4-22 Employee visibility of risk.** **None (confirms Phase 1 D17): no `/me/risk`.**
23. **D4-23 RiskProfile defaults.** **Sub-scores and `riskLevel` default to `null` ("Not assessed") instead of 0 and `Low` (closes U7).**
24. **D4-24 Risk history.** **Append-only `riskassessments`, written only on change; retention indefinite until Phase 10.**
25. **D4-25 Model-upgrade transitions.** **Escalate and audit like any other transition (trigger `model_upgrade`).**
26. **D4-26 Transactions.** **None; ordered idempotent writes plus reconcile (as D3-23).**

## 18. Phase 4 acceptance checklist
**Setup**
- [ ] Phase 3 is merged to `main`; branch `phase-04-gamification-risk` is cut from `main`; Conventional Commits; no direct commits to `main`.
- [ ] D4-1..D4-26 are answered; ADR 0009–0012 are set to Accepted (or amended); ADR 0005 has a pointer to 0011 and 0012.
- [ ] No new runtime dependencies; `npm audit --audit-level=high` is clean.

**Shared (pure, fully unit-tested)**
- [ ] `RISK_WEIGHTS` is asserted exactly as 0.3 / 0.25 / 0.3 / 0.15 and `RISK_WEIGHTS_BP` as 3000 / 2500 / 3000 / 1500; single-dimension composites prove each weight (RW1–RW6).
- [ ] `classifyRisk` boundaries 39/40 and 69/70, half-up at 39.5 and 69.5, and rejection of invalid input are tested (RB1–RB6).
- [ ] Sub-score functions, re-normalisation, coverage, minimum evidence and `decideRiskTransition` are tested (KN, BH, SM, EN, RP, RT).
- [ ] `LEVEL_THRESHOLDS` = 0 / 300 / 900 / 2000 / 3500; `levelForXp` and `levelProgress` boundaries are tested (LV1–LV4).
- [ ] `computeXp` is keyed and idempotent and cannot be farmed (XP1–XP10). The escalation state machine table is tested (ES1–ES2).
- [ ] The request, response and authoring schemas are strict; SC1–SC4 are green.

**Data model**
- [ ] `badgeawards` (unique `{userId, badgeId}`, append-only), `riskassessments` (append-only), `escalations` (unique `dedupeKey`, one active risk escalation per user) and `reconcilemarkers` exist with tested indexes.
- [ ] RiskProfile is nullable ("Not assessed") with composite, coverage, model version and `rev`.
- [ ] AuditLog has `seq`, `prevHash`, `hash` and `idempotencyKey`; a direct create without the chain fails; `insertMany` is blocked.

**Behaviour**
- [ ] Completing a module awards XP and its badge exactly once, under replay, concurrency and hook redelivery; retries never earn XP (GA1–GA8).
- [ ] The risk profile is recomputed on every attempt and equals the pure function over DB facts; concurrent recomputations converge (RR1–RR6).
- [ ] Entering High opens one `elevated` escalation plus audit entries; re-entry while active retriggers; Medium is audited only; critical events open `management`-tier escalations (GE1–GE7).
- [ ] The escalation workflow enforces the state machine, optimistic concurrency, resolution notes and the management reference; every event has exactly one audit entry; note text is never in audit metadata (EW1–EW9).
- [ ] Hook, audit or escalation failures never fail a submission; markers and the sweeper repair them (GE8, RC4); the reconcile CLI is idempotent and has a dry-run (RC1–RC5).
- [ ] The audit chain verifies; tampering, deletion and reordering are detected; concurrent writers stay dense (AC1–AC9); `audit:verify` works from the CLI.

**API and authorization**
- [ ] Exactly the 8 routes in §7 are added with the stated access; B1 inventory updated; B2, B3 and B7 cover them; B8 IDOR sweep green; audit logs are read-only (AL2).
- [ ] `/me/xp` and `/me/badges` return only the caller's data (MG3); no `/me/risk` exists.

**Gate**
- [ ] `gamification.journey.test.ts` shows:
  - exact weights and bands (the unit half)
  - completing a module awards XP and a badge, exactly once
  - retries do not farm
  - a crafted high-risk employee (composite 71) produces an escalation and an `escalation.opened` audit record visible through the admin API
  - acknowledge and resolve are audited
  - the chain verifies
  - an employee is denied on admin routes

**Docs and Definition of Done**
- [ ] `contract.md` (8 routes, DTO names, error codes, deferrals), `data-model.md`, `.env.example` (`AUDIT_CHAIN_SECRET`, `RECONCILE_SWEEP_INTERVAL`) and the README (`seed:badges`, `gamification:reconcile`, `audit:verify`) are updated; the contract matches the B1 inventory.
- [ ] `npm run lint`, `typecheck`, `test`, `build` and `format:check` pass; CI is green; the Phase 0–3 suites are still green (including the updated AU3).
- [ ] A security-tester review (focus: the audit chain, the outbox, IDOR on the admin risk and escalation routes, note handling) has no open High or Critical findings; `/verify` passes.
