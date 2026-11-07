# CSense Phase 3 plan: the learning engine

Status: **Approved 2026-11-06.** All decisions in section 17 (D3-1 to D3-24) approved as recommended (bold defaults). D3-17 deviates from the playbook build prompt (API-level gate journey now; UI + Playwright journey in Phase 6) and is flagged in the PR. Branch:
`phase-03-learning-engine`. ADRs: 0006, 0007, 0008 (Accepted). Handed to the
backend-engineer.

No feature code was written. No existing file was modified. I created this plan and three ADRs.

## 0. Sources and caveats
- **Read:**
  - CLAUDE.md, docs/api/contract.md, docs/architecture/data-model.md, docs/architecture/phase-02-plan.md, ADR 0001, 0004, 0005, docs/BUILD_PLAYBOOK.md (Phases 3, 4 and 6), docs/design/screens.md
  - both UML PNGs
  - server models: Module, Assessment, QuizAttempt, UserProgress, Badge, question.schema, schemaOptions
  - the Phase 2 HTTP layer: routeRegistry, accessGate, apiRouter, validate, routes.ts, app.ts, appConfig, httpError, audit.service, users.service and routes
  - test helpers and setup, `rbac.denyByDefault.test.ts`
  - shared constants, types and schemas
  - desktop `ModulePlayer`, `Quiz` and `EmployeeDashboard` types and fixtures; `ModuleCard`, `ModuleList`, `InteractiveExercise`, `TranscriptPanel`; `AttemptsIndicator` usage; the e2e smoke spec; CI
- **Client Needs doc:** binary. I used the verbatim-in-substance requirements in the task brief, labelled here:
  - **N1** sequential locked modules (video and interactive); the next module unlocks only after the current module's quiz is passed at the required score.
  - **N2** video lessons and interactive exercises with immediate right/wrong feedback and short explanations.
  - **N3** a multiple-choice quiz per module (about 5 questions) with a pass threshold; review answers and retry on failure.
  - **N4** a final assessment of about 15 questions after all modules are completed.
  - **N5** assumptions: 7 modules (Welcome, and phishing and social engineering as separate modules); threshold configurable per module, default 70%; no offline caching.
- **UML used:**
  - Class diagram: `Module.unlockNext()`, `UserProgress.unlockModule()`, `Assessment.grade(answers): int`, `Employee.completeModule(m)`.
  - Use cases: View Learning Content; Complete Learning Module (includes Take Module Quiz, extended by Award Badge); Take Module Quiz and Take Final Assessment (both include Update Risk Profile); View Progress Dashboard.
- **Phase 1 UI decisions that constrain the API:**
  - D5: leaving a quiz counts as an attempt.
  - D6: quiz feedback is shown at review only.
  - D7: the quiz unlock rule is decided outside the UI (`canStartQuiz`, `quizLockedReason`).
- **Baseline:** Phase 2 is uncommitted on `phase-02-auth-security` and under security review. Phase 3 must branch from `main` **after Phase 2 merges**. Several files this plan changes (`errors.ts`, `routes.ts`, `app.ts`, `env.ts`, `testConfig.ts`, the RBAC test) may still move during that review.

## 1. Scope and requirement map
| # | Item | Requirement |
|---|---|---|
| 1 | Module content model (video with captions and transcript, interactive exercises, publish state, minutes) | N1, N2, Class UML Module |
| 2 | Strict-prefix unlock rule, derived state (ADR 0006) | N1, `Module.unlockNext()`, `UserProgress.unlockModule()` |
| 3 | UserProgress facts (started, content complete, exercise answers, attempts, best score, passed) | Class UML UserProgress; N2; D7 |
| 4 | Exercise feedback endpoint (key revealed only after answering) | N2 (immediate feedback and explanation) |
| 5 | Pre-quiz content gate | D7 (`canStartQuiz`); **no explicit needs-doc requirement** (flagged, D3-7) |
| 6 | Assessment sessions, server grading, single-use submit (ADR 0007) | N3, `Assessment.grade()`, playbook gate "server rejects a forged pass", D5 |
| 7 | Per-module threshold on `Quiz.passingScore` (default 70) | N5, CLAUDE.md open question |
| 8 | Review with a reveal policy | N3 (review answers) |
| 9 | Unlimited retries | N3 (retry on failure); the quiz UI shows an attempt number only |
| 10 | Final assessment (about 15 questions, unlocked when all modules are passed) | N4 |
| 11 | `/me/attempts` history (self, IDOR-safe) | Contract (Phase 3); View Progress Dashboard |
| 12 | Learning hooks seam (ADR 0008) | UML: Award Badge, Update Risk Profile; contract "completion and badge are server side effects" |
| 13 | Idempotent dev/test seed: 7 modules, 7 quizzes of 5, final test of 15 | N4, N5; playbook Phase 6 "seeded employee" |
| 14 | Error codes for locked and conflict states | ADR 0005 error model |

**Flagged as having no explicit requirement (recommended, cheap):**
- `keyTakeaways` on Module (UI-driven)
- per-session question shuffle
- session TTL
- append-only enforcement on QuizAttempt
- strict response schemas plus leak-scan tests
- `ASSESSMENT_SESSION_TTL` env key

**Out of scope (deferred):**
- XP, levels, badge award and risk updates: Phase 4 (only the seam now)
- `/me/dashboard`, `/me/badges`, `/me/progress`: Phase 6, or Phase 4 for badges (D3-18)
- desktop wiring: Phase 6 (D3-17)
- kiosk lockdown: Phase 5
- admin content, quiz, final-test, order, publish and assignment routes, including `GET/PUT /admin/modules/:moduleId/quiz` (D3-16): Phase 7
- badge seed: Phase 4 (D3-21)
- offline caching: not required (N5)

## 2. Progression model (ADR 0006)

### 2.1 Curriculum
`curriculumFor(userId)` returns the published modules in ascending `order` (Phase 3: every published
module, D3-6). This is the **only** place Phase 7 assignment filtering will go.

### 2.2 Derived status, one pure function in `@csense/shared`
```ts
// shared/src/learning/unlock.ts
interface CurriculumModule { id: string; order: number }
interface ModuleFacts { started: boolean; passed: boolean }
interface DerivedModuleState {
  moduleId: string;
  position: number;                 // 1-based within the curriculum
  status: ProgressStatus;           // 'locked' | 'unlocked' | 'in_progress' | 'completed'
  lockedBy: string | null;          // frontier moduleId when locked, else null
}
deriveModuleStates(modules: readonly CurriculumModule[], facts: ReadonlyMap<string, ModuleFacts>): DerivedModuleState[]
deriveFinalTestState(states: readonly DerivedModuleState[], final: { passed: boolean; started: boolean }):
  { status: ProgressStatus; remainingModules: number }
isModuleAccessible(state: DerivedModuleState): boolean   // status !== 'locked'
```
Rules:
- Sort by `order`, with `id` as a stable tie-break; gaps are ignored.
- The frontier is the first module that is not passed. Every module **before** the frontier is passed by definition.
- For each module:
  - passed → `completed`
  - the frontier → `in_progress` if started, else `unlocked`
  - any other module → `locked`, with `lockedBy` = the frontier
- Final test:
  - `completed` if passed
  - else `locked` if the curriculum is empty or any module is unpassed
  - else `in_progress` if started, otherwise `unlocked`
- Ids absent from `modules` (unpublished) are ignored.

### 2.3 Stored UserProgress facts
- Rows are created on first interaction (start, exercise answer or content complete), with status `in_progress`.
- Status becomes `completed` on first pass.
- Rows are **never** stored as `locked` or `unlocked`. Reads always go through `deriveModuleStates`.

### 2.4 State machine (employee-visible)
```
locked ──(every earlier curriculum module passed)──> unlocked ──(start | exercise answer | content complete)──> in_progress
in_progress ──(content complete: all exercises answered + lesson reported)──> [quiz available]
[quiz available] ──(attempt passed)──> completed            (terminal; never reverts)
[quiz available] ──(attempt failed/abandoned/expired)──> in_progress (retry, unlimited)
in_progress/unlocked ──(admin reorder puts an unpassed module ahead, Phase 7)──> locked (facts kept)
```
Quiz availability (`canStartQuiz`) is true only when all of these hold:
- the module is accessible
- it is not passed
- `contentCompletedAt` is set
- a Quiz with at least one question exists

Otherwise `blockedReason` is one of `module_locked`, `content_incomplete`, `already_passed` or `quiz_unavailable`.

### 2.5 Content completion (D3-7)
`POST /modules/:id/content/complete` succeeds only if every exercise in the module has a recorded
answer; otherwise it returns 409 `CONTENT_INCOMPLETE`.
- For video modules the client calls it when the lesson ends. This is reported by the client and cannot be verified (ADR 0006).
- It is idempotent: the first `contentCompletedAt` is kept.

### 2.6 Edge rules
- An unpublished or unknown module returns 404 on every employee route.
- A published module without a Quiz cannot be completed. The overview returns `quiz: null` and a warning is logged. Phase 7 must require a quiz with at least one question before publishing.
- Completed modules stay readable, including their content and re-answering exercises for feedback. A quiz that is already passed is closed (409 `ALREADY_PASSED`).

## 3. Data model changes
All schemas keep `strict: 'throw'`, integer validators and `toJSON` id mapping. Responses are always
built by **explicit mappers** (whitelists), never by `doc.toJSON()`.

### 3.1 Module (`modules`, change)
| Field | Change | Rules |
|---|---|---|
| order, title, description, format, duration, isPublished | unchanged | `duration` = estimated minutes |
| content | unchanged | plain-text lesson body (rendered as text, never HTML; Phase 6 may adopt a safe Markdown renderer) |
| videoUrl | unchanged | the authoring schema requires https |
| captionsUrl | **new** | optional, https URL (WebVTT) |
| transcript | **new** | `[{ startSeconds int ≥0, text 1..2000 }]`, `_id:false`, max 500 cues; cue id = array index in the DTO |
| keyTakeaways | **new** (UI-driven) | `[String 1..300]`, max 10 |
| exercises | **new** | `[exerciseSchema]`, max 20 |

`exerciseSchema` (new file `models/schemas/exercise.schema.ts`), `_id:false`:
- `exerciseId` ObjectId, auto
- `prompt` 1..2000
- `artifact` optional, ≤2000 (plain text, such as a mock SMS)
- `options` `[String 1..300]`, 2..6
- `correctAnswer` int index into `options`, `select:false`
- `explanation` 1..1000, `select:false`

Publish invariant (`pre('validate')`, only when `isPublished`):
- `format:'video'` requires `videoUrl`
- `format:'interactive'` requires at least one exercise

Indexes unchanged.

### 3.2 Question (embedded, change)
- Add `explanation`: String, 0..1000, default `''`, `select:false`.
- Add `maxlength` 1000 to `text`, 300 to each option, and a maximum of 6 options.
- `correctAnswer` stays `select:false`.
- The authoring schema requires a non-empty explanation (seed and Phase 7).

### 3.3 Assessment / Quiz / FinalTest
- No schema change. The **per-module threshold is `Quiz.passingScore`** (Quiz is 1:1 with Module), default 70 (D3-2).
- FinalTest has `passingScore`, default 70.
- There is no `Module.passThreshold`, to avoid two sources of truth.

### 3.4 UserProgress (`userprogresses`, change)
| Field | Change | Meaning |
|---|---|---|
| status | semantics | stored as `in_progress` or `completed` only (§2.3) |
| quizScore | semantics | **best** score (`$max`) |
| quizPassed, completedAt | unchanged | first pass sets both (conditional update) |
| attempts | semantics | count of submitted + abandoned + expired attempts |
| startedAt | **new** | Date, set on insert |
| contentCompletedAt | **new** | Date or null |
| exerciseAnswers | **new** | `[{ exerciseId, selectedIndex int, correct bool, answeredAt }]`, `_id:false`; first answer per exercise only, max 20 |
| lastAttemptAt | **new** | Date or null |

Indexes unchanged (`{userId,moduleId}` unique; `{moduleId,status}`).

### 3.5 QuizAttempt (`quizattempts`, change; append-only enforced)
| Field | Change | Rules |
|---|---|---|
| userId, type, refId, score, passed, attemptedAt | unchanged | |
| answers | change | `selectedIndex` may be `null` (unanswered); one entry per **served** question, in served order |
| sessionId | **new** | ObjectId → AssessmentSession, required, **unique** |
| moduleId | **new** | ObjectId or null (null for FinalTest); denormalised for filters |
| attemptNumber | **new** | int ≥1, per (user, assessment) |
| endReason | **new** | `submitted` \| `abandoned` \| `expired` |
| correctCount, totalCount | **new** | int ≥0 / ≥1 |
| passingScore | **new** | int 0..100, snapshot at session start |

- **Indexes:** existing ones, plus:
  - `{sessionId:1}` unique
  - `{userId:1, attemptedAt:-1, _id:-1}` (for `/me/attempts`)
  - `{userId:1, refId:1, passed:1}`
- **Immutability (D3-20):** the same middleware set as AuditLog throws `QuizAttemptImmutableError` on `save` (not new), `update*`, `findOneAndUpdate`, `replaceOne`, `findOneAndReplace`, `delete*`, `findOneAndDelete` and `bulkWrite`. It goes in a new reusable plugin `models/plugins/appendOnly.ts`. AuditLog is **not** refactored in Phase 3.

### 3.6 AssessmentSession (`assessmentsessions`, new; ADR 0007)
| Field | Type | Rules |
|---|---|---|
| userId | ObjectId → User | required |
| kind | `Quiz` \| `FinalTest` | required |
| assessmentId | ObjectId → Assessment | required |
| moduleId | ObjectId or null | required for Quiz |
| status | `open` \| `submitted` \| `abandoned` \| `expired` | default `open` |
| questions | `[{ questionId, optionCount int 2..6, correctAnswer int (select:false) }]`, `_id:false` | served order (shuffled), at least 1 |
| passingScore | int 0..100 | snapshot |
| expiresAt | Date | startedAt + `ASSESSMENT_SESSION_TTL` |
| closedAt | Date or null | |
| createdAt (`startedAt`) | Date | `timestamps: { createdAt: 'startedAt', updatedAt: false }` |

**Indexes:**
- `{userId:1, assessmentId:1}` unique, partial on `{status:'open'}` (at most one open session)
- TTL `{expiresAt:1}` with `expireAfterSeconds: 2592000` (30 days)

`toJSON` never emits `questions`.

## 4. Grading and review (pure, `@csense/shared`)
```ts
// shared/src/learning/grading.ts
interface ServedQuestion { questionId: string; optionCount: number; correctAnswer: number }
interface SubmittedAnswer { questionId: string; selectedIndex: number | null }
type AnswerIssue = { index: number; field: 'questionId' | 'selectedIndex'; reason: 'not_served' | 'duplicate' | 'out_of_range' };
validateAnswers(served, answers): AnswerIssue[]
gradeAttempt(served, answers, passingScore): {
  answers: { questionId: string; selectedIndex: number | null; correct: boolean }[]; // served order
  correctCount: number; totalCount: number; score: number; passed: boolean }
computeScore(correct, total): number      // floor(100*correct/total); total ≥ 1 else throws
isPass(score, passingScore): boolean       // score >= passingScore
// shared/src/learning/review.ts
revealPolicy(attempt: { endReason; passed }, assessmentPassed: boolean):
  { showCorrectness: boolean; showExplanation: boolean; showCorrectOption: boolean }
```
**Reveal policy (D3-13):**
- `submitted` attempt: correctness and explanation shown; the correct option only if the assessment has been passed (by this or any later attempt)
- `abandoned` or `expired` attempt: `review: []`

**Sanity values at the default 70 threshold:**
- 5 questions: 3/5 = 60 fails, 4/5 = 80 passes
- 15 questions: 10/15 = 66 fails, 11/15 = 73 passes
- "3 of 5" is reached by setting `passingScore: 60` on that quiz (open question resolved by data)

## 5. API (all under `/api/v1`, Phase 3 inventory)
Access: every route is `EMPLOYEE_ONLY` (`{kind:'role', roles:['employee']}`). The contract's "self"
level means employee-only plus identity taken from the token. No route takes a user id.

| # | Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|---|
| 1 | GET | `/modules` | none | 200 `LearningOverviewDTO` | |
| 2 | GET | `/modules/:moduleId` | none | 200 `ModuleDetailDTO` | 404, 403 `MODULE_LOCKED` |
| 3 | POST | `/modules/:moduleId/start` | none / `{}` | 200 `ModuleProgressDTO` (idempotent) | 404, 403 |
| 4 | POST | `/modules/:moduleId/exercises/:exerciseId/answers` | `{selectedIndex}` | 200 `ExerciseFeedbackDTO` | 404, 403, 400 (out of range) |
| 5 | POST | `/modules/:moduleId/content/complete` | none / `{}` | 200 `ModuleProgressDTO` | 404, 403, 409 `CONTENT_INCOMPLETE` |
| 6 | GET | `/modules/:moduleId/quiz` | none | 200 `QuizOverviewDTO` (never questions) | 404, 403 |
| 7 | POST | `/modules/:moduleId/quiz/sessions` | none / `{}` | 201 `AssessmentSessionDTO` | 404, 403, 409 `CONTENT_INCOMPLETE` / `ALREADY_PASSED` / `CONFLICT` (concurrent start) |
| 8 | POST | `/modules/:moduleId/quiz/sessions/:sessionId/abandon` | none / `{}` | 201 `AttemptResultDTO` (`endReason:'abandoned'`) | 404, 409 `SESSION_CLOSED` |
| 9 | POST | `/modules/:moduleId/quiz/attempts` | `SubmitAttemptRequest` | 201 `AttemptResultDTO` | 400, 404, 403, 409 `SESSION_CLOSED` / `SESSION_EXPIRED` |
| 10 | GET | `/final-test` | none | 200 `FinalTestOverviewDTO` (also when locked; no questions) | 404 if no FinalTest |
| 11 | POST | `/final-test/sessions` | none / `{}` | 201 `AssessmentSessionDTO` | 404, 403 `FINAL_TEST_LOCKED`, 409 |
| 12 | POST | `/final-test/sessions/:sessionId/abandon` | none / `{}` | 201 `AttemptResultDTO` | 404, 409 |
| 13 | POST | `/final-test/attempts` | `SubmitAttemptRequest` | 201 `AttemptResultDTO` | 400, 404, 403, 409 |
| 14 | GET | `/me/attempts` | `?kind=&moduleId=&limit=&before=` | 200 `{ items: AttemptSummaryDTO[], nextCursor: string \| null }` | 400 |
| 15 | GET | `/me/attempts/:attemptId` | none | 200 `AttemptDetailDTO` | 404 (also another user's) |

**Contract changes, written into `contract.md` by the implementer:**
- Rows 4, 5, 7, 8, 11 and 12 are new.
- Row 6 no longer returns questions.
- `/me/dashboard`, `/me/progress` and `/me/badges` move to Phase 6 (D3-18).
- `GET/PUT /admin/modules/:moduleId/quiz` moves to Phase 7 (D3-16).

Locked → **403** with a specific code, not 423 (ADR 0006 §9, D3-14).

### 5.1 Shared request schemas (`shared/src/schemas/learning.ts`, all `.strict()`)
```ts
moduleParamsSchema        = { moduleId: objectIdSchema }
exerciseParamsSchema      = { moduleId, exerciseId: objectIdSchema }
moduleSessionParamsSchema = { moduleId, sessionId: objectIdSchema }
sessionParamsSchema       = { sessionId: objectIdSchema }
attemptParamsSchema       = { attemptId: objectIdSchema }
exerciseAnswerRequestSchema = { selectedIndex: z.int().min(0).max(5) }
submitAttemptRequestSchema  = {
  sessionId: objectIdSchema,
  answers: z.array({ questionId: objectIdSchema, selectedIndex: z.int().min(0).max(5).nullable() }.strict())
           .max(MAX_ANSWERS_PER_SUBMISSION /* 100 */)
           .refine(unique questionId, 'duplicate questionId')
}                                     // no score / passed / correct fields: strict rejects them
listAttemptsQuerySchema = { kind?: enum(ASSESSMENT_KINDS), moduleId?: objectIdSchema,
                            limit?: z.coerce.number().int().min(1).max(100) (default 20), before?: objectIdSchema }
```
Body-less POSTs use the registry default (`undefined` or `{}` only).

### 5.2 Shared response schemas and DTO types (`shared/src/schemas/learningResponses.ts`)
These are strict zod objects. DTO types are `z.infer` of them (`shared/src/types/learning.ts` re-exports
the types). Server tests parse every response with them, so any extra field such as a leaked
`correctAnswer` fails the test. Phase 6 parses with them on the client.
```ts
ModuleSummaryDTO   { id, position, title, description, format, durationMinutes, status: ProgressStatus,
                     lockedBy: { moduleId, position, title } | null, attempts, bestScore: number | null,
                     passed, completedAt: string | null }
FinalTestStatusDTO { status: ProgressStatus, title, questionCount, passingScore, remainingModules,
                     attempts, bestScore: number | null, passed, completedAt: string | null }
LearningOverviewDTO { modules: ModuleSummaryDTO[], totalModules, completedCount,
                      nextModuleId: string | null, finalTest: FinalTestStatusDTO | null }
ModuleProgressDTO  { moduleId, status, startedAt: string | null, contentCompletedAt: string | null,
                     exerciseAnswers: { exerciseId, selectedIndex, correct }[] }
ModuleDetailDTO    { module: ModuleSummaryDTO,
                     content: { body, keyTakeaways: string[],
                                video: { url, captionsUrl: string | null,
                                         transcript: { id, startSeconds, text }[] } | null,
                                exercises: { exerciseId, prompt, artifact: string | null, options: string[] }[] },
                     progress: ModuleProgressDTO, quiz: QuizOverviewDTO | null }
ExerciseFeedbackDTO { exerciseId, selectedIndex, correct, correctIndex, explanation, recorded: boolean }
QuizOverviewDTO    { quizId, moduleId, title, questionCount, passingScore, attempts, nextAttemptNumber,
                     bestScore: number | null, passed, canStart: boolean,
                     blockedReason: 'module_locked'|'content_incomplete'|'already_passed'|'quiz_unavailable'|null }
FinalTestOverviewDTO = FinalTestStatusDTO & { finalTestId, nextAttemptNumber, canStart, blockedReason }
AssessmentSessionDTO { sessionId, kind, assessmentId, moduleId: string | null, title, passingScore,
                       attemptNumber, startedAt, expiresAt,
                       questions: { questionId, text, options: string[] }[] }   // no key, no explanation
ReviewItemDTO      { questionId, text, options, selectedIndex: number | null, correct,
                     explanation?: string, correctIndex?: number }               // per reveal policy
AttemptSummaryDTO  { attemptId, kind, assessmentId, moduleId: string | null, attemptNumber, endReason,
                     score, passed, correctCount, totalCount, passingScore, attemptedAt }
AttemptDetailDTO   = AttemptSummaryDTO & { review: ReviewItemDTO[] }
AttemptResultDTO   = AttemptDetailDTO & {
                     progression: { moduleCompleted: boolean, nextModuleId: string | null,
                                    finalTestUnlocked: boolean },
                     effects: { xpEarned?: number, badge?: { id, name, iconMotif } } }
```
**Notes:**
- `position` is the 1-based curriculum position, which is what the UI shows as "Module 3 of 7". The admin `order` is not exposed to employees.
- `lockedBy` names the frontier module, so the UI text stays actionable after reorders.
- Review items read question text from the **current** assessment by `questionId`. If an item was deleted (Phase 7), the text is `"This question is no longer available"` with empty options.
- The existing `shared/src/types/assessment.ts` changes: `AnswerDTO.selectedIndex: number | null`. `QuizAttemptDTO` gains the new fields (or is replaced by `AttemptSummaryDTO`). The desktop does not import either today.

### 5.3 New error codes (`shared/src/constants/errors.ts`) and `HttpError` factories
| Code | Status | When |
|---|---|---|
| `MODULE_LOCKED` | 403 | module (or its quiz/exercises) not accessible in the employee's sequence |
| `FINAL_TEST_LOCKED` | 403 | starting or submitting the final test before every curriculum module is passed |
| `CONTENT_INCOMPLETE` | 409 | quiz session before content completion; content complete before all exercises are answered |
| `ALREADY_PASSED` | 409 | new session for an assessment already passed |
| `SESSION_CLOSED` | 409 | submit or abandon on a session already submitted, abandoned or expired (replay, race loser) |
| `SESSION_EXPIRED` | 409 | submit after `expiresAt`; an `expired` attempt is recorded |
| `CONFLICT` (existing) | 409 | concurrent session start lost the partial-unique race. The contract note "admin routes only" is widened |

Answer-set problems (unserved or duplicate question, index ≥ the option count) return
`VALIDATION_ERROR` 400. Details use `location:'body'`, a `path` such as `answers.2.questionId` and a
message, and never the submitted value. The session stays open.

### 5.4 Submit algorithm (`assessment.service.submitAttempt`), routes 9 and 13
1. zod (strict) → `ctx.body`.
2. Resolve the assessment from the route:
   - module route: published module → its Quiz, else 404
   - final route: the FinalTest, else 404
3. Load the session with `{_id: sessionId, userId: auth.userId, assessmentId}` and `+questions.correctAnswer`. If none, 404. This covers another user's session, another module's session and an unknown id.
4. If `status !== 'open'`, 409 `SESSION_CLOSED`.
5. If `now ≥ expiresAt`, run `closeSession(expired)` (step 9 and on) and return 409 `SESSION_EXPIRED`.
6. Re-derive access with `curriculumFor` + `deriveModuleStates`. If the module or final test is not accessible, 403 (the session stays open).
7. `validateAnswers`. If there are issues, 400 and the session stays open.
8. `gradeAttempt(snapshot, answers, session.passingScore)`.
9. **Claim:** `findOneAndUpdate({_id, status:'open', expiresAt:{$gt: now}}, {$set:{status:'submitted', closedAt: now}})`. If null, 409 `SESSION_CLOSED` (race loser).
10. `attemptNumber = countDocuments({userId, refId}) + 1`. Only one open session exists per assessment and claims are atomic, so this is serialised. Insert the `QuizAttempt` (unique `sessionId`; a duplicate-key error becomes 409 `SESSION_CLOSED`).
11. **Progress** (Quiz only):
    - `updateOne({userId, moduleId}, {$inc:{attempts:1}, $max:{quizScore:score}, $set:{lastAttemptAt}}, {upsert:true})`
    - if passed, `updateOne({userId, moduleId, quizPassed:false}, {$set:{quizPassed:true, status:'completed', completedAt: now}})`
    - `firstPass = modifiedCount === 1`
    - For the FinalTest, `firstPass` = no earlier passed FinalTest attempt (checked before the insert).
12. **Hooks** (ADR 0008):
    - always `onAttemptRecorded`
    - if `firstPass`, `onModuleCompleted` or `onFinalTestPassed`
    - errors are logged and their effects omitted
13. Re-derive states to compute `progression` (`nextModuleId`, `finalTestUnlocked`), build the review with the reveal policy, and return 201.

`closeSession(reason)` (abandon, expiry, auto-abandon on a new start) runs the same steps 9 to 12 with
`status: reason`, an answers list of every served question with `selectedIndex:null`, score 0 and
`passed:false`.

### 5.5 Session start (routes 7 and 11)
1. Check access: 403 if locked.
2. The assessment must exist with at least one question, else 404.
3. If already passed, 409 `ALREADY_PASSED`.
4. Quiz only: `contentCompletedAt` must be set, else 409 `CONTENT_INCOMPLETE`.
5. Close any open session for `(user, assessment)`: `abandoned`, or `expired` if past `expiresAt` (D3-11).
6. Load the assessment with `+questions.correctAnswer`, shuffle the question order with `crypto.randomInt` (Fisher-Yates), and keep the option order (D3-10).
7. Insert the session. On a duplicate key against the partial unique index, return 409 `CONFLICT`.
8. Return the DTO. `attemptNumber` = existing attempts + 1, for display only.

## 6. Tamper resistance (each item has a test in §12)
| Threat | Control |
|---|---|
| Client-claimed pass (`passed`, `score`, `correct` in the body; a progress PATCH; a "complete module" call) | Strict zod 400; no such routes exist (404); pass is decided only by `gradeAttempt` on the server snapshot |
| Submitting or starting for a locked module or a locked final test | Access re-derived on start **and** submit → 403 |
| Session from module A submitted on module B's route | Session lookup is scoped by `assessmentId` → 404 |
| Answers for questions not served (other quiz, final test, made up) | `validateAnswers` → 400, session stays open |
| Out-of-range or duplicate answers | zod max 5 plus a per-question `optionCount` check; duplicate refine → 400 |
| Replay of a submission | Single-use claim → 409 `SESSION_CLOSED`; unique `sessionId`; no second hook call |
| Two concurrent submissions | Atomic claim: exactly one 201, one 409; one attempt; `attempts` +1 |
| Concurrent session starts | Partial unique index: at most one open session; loser 409 `CONFLICT` |
| Submit after the time limit | 409 `SESSION_EXPIRED`; an `expired` attempt is recorded |
| Reading another employee's attempt or session (IDOR) | Only `/me/...`; every query includes `userId: auth.userId`; mismatch → 404 (not 403) |
| Answer-key leakage | `select:false` on keys and explanations; whitelist mappers; strict response schemas; deep-scan tests for `correctAnswer`/`correctIndex`/`explanation` outside allowed responses |
| Draft disclosure | Unpublished modules → 404; absent from lists |
| Admin token on employee routes | Exact role match → 403 (new sweep B7) |
| Operator injection in params or query | objectId regex + `sanitizeFilter` (Phase 2) |
| Admin edits during a session (Phase 7) | Grading uses the session's key snapshot |

Learning events are **not** audit-logged in Phase 3 (D3-19). Replays and expired submits are logged
at `warn` with the request id. Phase 4 decides which learning signals become audit or behavioural data.

## 7. Phase 4 seam (ADR 0008)
`server/src/features/learning/learningHooks.ts` exports `LearningHooks`, the event types and
`noopLearningHooks`.

Event payloads:
- `AttemptRecordedEvent`: `{ userId, attemptId, kind, assessmentId, moduleId|null, attemptNumber, endReason, score, passed, correctCount, totalCount, at }`
- `ModuleCompletedEvent`: `{ userId, moduleId, attemptId, attemptNumber, score, at }`
- `FinalTestPassedEvent`: `{ userId, assessmentId, attemptId, attemptNumber, score, at }`

Wiring:
- `AppOptions.learningHooks?` (default noop) goes into `RouteDeps`.
- `QuizResultData.xpEarned` and `badge` map from `effects`.
- Phase 4 should use `attemptNumber === 1` results as the Knowledge input (ADR 0007).

## 8. Configuration
| Key | Rule | Default |
|---|---|---|
| `ASSESSMENT_SESSION_TTL` | `^\d+[smhd]$`, 5m..4h | `60m` |

- Goes into `AppConfig.learning.sessionTtlSeconds`, and into `testConfig` with a default of 3600.
- `.env.example` gets a documented line. No new secrets.

## 9. Seed (dev/test only)
**Files:**
- `server/src/scripts/seedLearning.ts`: exports `seedLearningContent(deps, opts)` plus a thin `main()`
- `server/src/scripts/seed/learningContent.ts`: the data

**Behaviour:**
- **Env:** its own zod schema (`MONGODB_URI`, `NODE_ENV`) so seeding needs no auth secrets. It refuses to run when `NODE_ENV=production` (exit 1).
- **Validation:** content is validated with the shared **authoring schemas** (`moduleAuthoringSchema`, `assessmentAuthoringSchema` in `shared/src/schemas/learningAuthoring.ts`, reused by Phase 7) before any write.
- **Idempotent, create-missing semantics:**
  - a module is keyed by `order`; its quiz by `moduleId`; the final test by `kind`
  - a missing item is created with `Model.create` (full validation)
  - an existing item is kept untouched
  - a duplicate key from a race counts as "kept"
- **Result:** `{ created: {modules, quizzes, finalTest}, kept: {...} }`.
- **`--reset`** (dev only): deletes modules, assessments, userprogresses, quizattempts and assessmentsessions **through the driver**, because QuizAttempt is append-only, then seeds again.
- **Scripts:** `"seed:learning": "node dist/src/scripts/seedLearning.js"`, `"seed:learning:dev": "tsx src/scripts/seedLearning.ts"`.

**Content:** placeholder but realistic, generic ("your organisation", "the security team"), and
reserved domains only (`example.com`, `example.net`). Titles follow the Phase 1 fixtures:

| Pos | Title | Format | Min | Exercises |
|---|---|---|---|---|
| 1 | Welcome to CSense | video | 6 | 0 |
| 2 | Passwords and authentication | interactive | 12 | 4 |
| 3 | Phishing | video | 12 | 2 (practice) |
| 4 | Social engineering | interactive | 10 | 4 |
| 5 | Safe browsing and downloads | video | 9 | 2 |
| 6 | Protecting devices and data | interactive | 11 | 4 |
| 7 | Reporting incidents | video | 7 | 1 |

- **Video modules:**
  - `videoUrl: https://media.example.com/csense/placeholder/mN.mp4`
  - `captionsUrl: .../mN.vtt`
  - 4 to 6 transcript cues
  - 3 key takeaways
- **Quizzes:**
  - each module's quiz has 5 questions with 3 or 4 options and an explanation of 300 characters or less that does not name the option
  - `passingScore` 70
  - the correct index is varied (not always 0)
- **Final test:** 15 new questions spanning all 7 modules, `passingScore` 70.
- **Excluded:** users, badges (Phase 4) and client branding (open question).

## 10. Files to create or change
**shared/**
- `src/constants/learning.ts` (new):
  - `MAX_ANSWERS_PER_SUBMISSION=100`, `MAX_OPTIONS=6`, `MAX_EXERCISES=20`, `MAX_TRANSCRIPT_CUES=500`, `MAX_KEY_TAKEAWAYS=10`
  - `MODULE_QUIZ_TARGET_QUESTIONS=5`, `FINAL_TEST_TARGET_QUESTIONS=15`
  - `ATTEMPT_END_REASONS`, `SESSION_STATUSES`, `QUIZ_BLOCKED_REASONS`
- `src/constants/errors.ts` (change: 6 codes)
- `src/learning/unlock.ts`, `grading.ts`, `review.ts`, `index.ts` (new) plus `unlock.test.ts`, `grading.test.ts`, `review.test.ts`
- `src/schemas/learning.ts`, `learningResponses.ts`, `learningAuthoring.ts` (new) plus `learning.schemas.test.ts`
- `src/types/learning.ts` (new); `src/types/assessment.ts` (change: `selectedIndex` nullable, attempt fields)
- `src/index.ts` (change: exports)

**server/**
- `src/models/Module.ts`, `UserProgress.ts`, `QuizAttempt.ts`, `schemas/question.schema.ts`, `index.ts` (change)
- `src/models/schemas/exercise.schema.ts`, `src/models/AssessmentSession.ts`, `src/models/plugins/appendOnly.ts` (new)
- `src/features/learning/` (new):
  - `curriculum.service.ts` (`curriculumFor`, `loadLearningState`)
  - `modules.service.ts`
  - `assessment.service.ts` (start, submit, close, overview)
  - `attempts.service.ts`
  - `learning.mapper.ts`
  - `learningHooks.ts`
  - `modules.routes.ts`, `assessment.routes.ts`, `attempts.routes.ts`
  - `shuffle.ts` (`crypto.randomInt` Fisher-Yates; injectable for tests)
- `src/lib/httpError.ts` (change: `moduleLocked`, `finalTestLocked`, `contentIncomplete`, `alreadyPassed`, `sessionClosed`, `sessionExpired` factories)
- `src/routes.ts` (change: `learningRoutes(deps)`; `RouteDeps.learningHooks`)
- `src/app.ts` (change: `AppOptions.learningHooks`)
- `src/config/env.ts`, `src/config/appConfig.ts` (change: TTL)
- `src/scripts/seedLearning.ts`, `src/scripts/seed/learningContent.ts` (new)
- `package.json` (change: seed scripts; no new dependencies)

**server/test/**
- `helpers/testConfig.ts` (change: `learning`)
- `helpers/learningFixtures.ts` (new):
  - `createCurriculum({ modules, formats, passingScore, published, exercises })`, which returns a key map
  - `createFinalTest()`
  - `completeContent()`
  - `startQuiz()`
  - `answersFor(session, keys, {correct: n})`
  - `passModule()`, `failModule()`
  - `scanForKeys(body)`
- `rbac.denyByDefault.test.ts` (change):
  - B1 inventory gains 15 rows
  - **B3's filter must become `roles.includes('administrator')`**, otherwise every employee route fails it
  - new B7: every employee-only route returns 403 `FORBIDDEN` for an admin token
- `models.indexes.test.ts` (change: AssessmentSession, the new QuizAttempt indexes, TTL, partial unique)
- `env.test.ts` (change: TTL bounds)
- New test files are listed in §12.

**desktop/**: no change in Phase 3 (D3-17).

**docs/** (implementer):
- `api/contract.md`: Phase 3 routes, error codes, the `/me` = employee-only note, deferrals
- `architecture/data-model.md`: §3 changes, AssessmentSession, derived status
- `README` (seed usage), `.env.example`
- ADR 0006 to 0008 status → Accepted after approval

## 11. Implementation sequence
1. Merge Phase 2 to `main` (after its security review). Branch `phase-03-learning-engine`.
2. **Shared:** constants, error codes, the pure `unlock`/`grading`/`review` functions with exhaustive unit tests, then the request, response and authoring schemas with tests, then the types and exports.
3. **Models:** question explanation, Module content and publish invariant, UserProgress fields, the QuizAttempt fields and the append-only plugin, AssessmentSession. Then the model and index tests.
4. Env and appConfig TTL, `testConfig`, the `HttpError` factories.
5. **Services:** curriculum, then modules (start, exercises, content complete), then assessment (overview, start, close, submit), then attempts. Hooks seam with noop.
6. Routes, `routes.ts`, `AppOptions`. Update the RBAC inventory, the B3 filter and B7.
7. Seed content, script and test.
8. Integration suites (§12), then the journey test (the gate).
9. Docs: contract, data model, README, `.env.example`.
10. Definition of Done: `lint`, `typecheck`, `test`, `build`, `format:check`, `audit:high`. Then a PR, and a security-tester review focused on §6.

## 12. Tests
All server tests use mongodb-memory-server and the injected clock. Every response body in the
integration suites is parsed with its strict shared response schema.

**Unit (shared)**
- **`unlock.test.ts`**
  - UL1: no progress → position 1 `unlocked`, the rest `locked` with `lockedBy` = module 1
  - UL2: started frontier → `in_progress`
  - UL3: passing N makes N+1 the frontier, and nothing beyond it unlocks
  - UL4: a failed attempt (not passed) never moves the frontier
  - UL5: order gaps (1, 5, 9) behave like 1, 2, 3; input order is irrelevant (sorted)
  - UL6: unpublished ids in the facts are ignored; removing a middle module from the curriculum makes the next one the frontier for someone who passed its predecessor
  - UL7: reorder (an unpassed module moved before passed ones): passed modules stay `completed`; the moved one is the frontier; later unpassed and started modules become `locked`
  - UL8: inserting a new module at position 1 for someone who passed everything: the new one is `unlocked`, the others stay `completed`, the final test is locked
  - UL9: an empty curriculum → no modules and the final test `locked`
  - UL10: the final test is `unlocked` only when all are passed, `completed` when passed, `in_progress` when started
  - UL11: property test (all 2^n pass patterns for n ≤ 8): at most one module is `unlocked`/`in_progress`; a module is accessible iff all earlier ones are passed; `remainingModules` equals the unpassed count
- **`grading.test.ts`**
  - GR1: 5/5 → 100 pass; 4/5 → 80 pass; 3/5 → 60 fail at 70; 3/5 passes at 60
  - GR2: 11/15 → 73 pass; 10/15 → 66 fail; 2/3 → 66 (floor)
  - GR3: threshold 0 always passes; threshold 100 needs all correct
  - GR4: property over all `c ≤ t ≤ 20` and thresholds 0..100: `passed ⇔ 100c ≥ T·t`; score is an integer in [0,100]
  - GR5: unanswered (`null` or missing) counts wrong; `totalCount` = served count; the output is in served order
  - GR6: `validateAnswers` flags `not_served`, `duplicate` and `out_of_range` with the correct index
  - GR7: an empty served set throws
- **`review.test.ts`**
  - RV1: failed and not yet passed → correctness and explanation, no correct option
  - RV2: passed → all three shown
  - RV3: a failed attempt viewed after a later pass → correct option shown
  - RV4: abandoned or expired → nothing (empty review)
- **`learning.schemas.test.ts`**
  - SC1: submit rejects `score`, `passed`, `correct`, `userId`, `__proto__`, more than 100 answers, duplicate `questionId`, a non-integer or negative index, and an index above 5
  - SC2: `null` index accepted
  - SC3: the list query coerces `limit` and rejects 0 and 101
  - SC4: the response schemas reject an extra `correctAnswer` on a question
  - SC5: the authoring schemas reject a published video module without `videoUrl`, a published interactive module without exercises, an http (non-https) URL, a key out of range and an empty explanation

**Integration (supertest, server/test)**
- **`models.learning.test.ts`**
  - ML1: `Module.find()` and `Quiz.find()` never return `exercises.correctAnswer`, `exercises.explanation`, `questions.correctAnswer` or `questions.explanation` unless selected with `+`
  - ML2: the publish invariant is enforced
  - ML3: QuizAttempt is append-only on every blocked path, and `create` works
  - ML4: the AssessmentSession partial unique index rejects a second open session but allows a second closed one; the TTL index exists
  - ML5: `toJSON` of a session has no `questions`
- **`modules.list.test.ts`**
  - ML-L1: a new employee sees module 1 `unlocked`, 2..n `locked` with `lockedBy`, and the final test `locked` with `remainingModules = n`
  - ML-L2: unpublished modules are absent and positions are contiguous
  - ML-L3: `bestScore` and `attempts` reflect the history
  - ML-L4: the admin token gets 403 and no token gets 401
- **`modules.detail.test.ts`**
  - MD1: an accessible module returns content with no key fields (deep scan)
  - MD2: a locked module → 403 `MODULE_LOCKED` with no content in the body
  - MD3: unpublished or unknown → 404; an invalid id → 400
  - MD4: a completed module stays readable
  - MD5: `quiz.blockedReason` follows §2.4
- **`modules.start.test.ts`**
  - ST1: start creates an `in_progress` row and is idempotent (same `startedAt`)
  - ST2: locked → 403 and no row created
  - ST3: start on a completed module does not change its status
- **`exercises.test.ts`**
  - EX1: answer → `correct`, `correctIndex` and `explanation`; only the first answer is recorded (`recorded:false` on repeats); the row is auto-started
  - EX2: out-of-range index → 400; unknown exercise → 404; locked module → 403
  - EX3: content complete → 409 until every exercise is answered, then 200; idempotent
- **`quiz.session.test.ts`**
  - QS1: the overview has no questions; start → 201 with questions (no keys or explanations, deep scan); the order is a permutation (injected shuffle) and the options keep their authored order
  - QS2: content incomplete → 409; locked → 403; already passed → 409 `ALREADY_PASSED`
  - QS3: starting while a session is open → the old one becomes `abandoned`, an attempt is recorded, and `attempts` +1 (D5)
  - QS4: explicit abandon → 201 with `endReason:'abandoned'` and score 0; a second abandon → 409 `SESSION_CLOSED`
  - QS5: `attemptNumber` increments across submit, abandon and expire
- **`quiz.submit.test.ts`**
  - QG1: a passing submission → 201, `passed`, `moduleCompleted:true`, `nextModuleId` = module 2; `UserProgress` is `completed` with `completedAt`; `GET /modules` shows module 2 `unlocked`
  - QG2: a failing submission → 201, `passed:false`, the review has correctness and explanation but **no `correctIndex`**; module 2 stays `locked`
  - QG3: retry after a fail, then pass; afterwards `GET /me/attempts/:failedId` shows `correctIndex`
  - QG4: `quizScore` is the best score, not the last
  - QG5: unanswered questions count wrong
  - QG6: a per-module threshold of 60 lets 3/5 pass while another module at 70 fails 3/5
- **`quiz.tamper.test.ts`**
  - TA1: a body with `passed:true` or `score:100` (with or without valid answers) → 400 and no attempt
  - TA2: `PATCH /me/progress`, `POST /modules/:id/complete` and `PUT /modules/:id/progress` → 404
  - TA3: a submit or start for a locked module → 403, and the progress is unchanged
  - TA4: a session from module 1 submitted on module 2's route → 404
  - TA5: answers with a `questionId` from another quiz, from the final test or made up → 400 with a path, and the session stays open (a later valid submit works)
  - TA6: replaying the same passing body → 409 `SESSION_CLOSED`; exactly one attempt; `attempts` unchanged; hooks called once
  - TA7: employee B submits or abandons A's session → 404, and A's session stays open
  - TA8: after the clock passes the TTL, submit → 409 `SESSION_EXPIRED`; an `expired` attempt is recorded; the module is not passed
  - TA9: an admin token on every learning route → 403
- **`quiz.concurrency.test.ts`**
  - CC1: `Promise.all` of two submits on one session → exactly one 201 and one 409; one QuizAttempt; `attempts === 1`; `onModuleCompleted` called once
  - CC2: submit racing abandon → exactly one wins
  - CC3: two concurrent starts → at most one open session remains; responses are {201, 201} with the first abandoned, or {201, 409 `CONFLICT`}; the invariant is asserted on the DB
- **`finalTest.test.ts`**
  - FT1: `GET /final-test` returns 200 while locked, with no questions
  - FT2: start → 403 `FINAL_TEST_LOCKED` until all modules are passed
  - FT3: after all are passed, start returns 15 questions (from the seed); fail then pass; `onFinalTestPassed` called once
  - FT4: a final-test session submitted on a module route → 404
  - FT5: no FinalTest document → 404
  - FT6: an empty curriculum → locked
- **`me.attempts.test.ts`**
  - MA1: lists only the caller's attempts, newest first; `before` cursor pagination; `kind` and `moduleId` filters
  - MA2: another user's `attemptId` → 404 (same body as a random id)
  - MA3: an invalid id → 400; an unknown query parameter → 400
  - MA4: the detail review follows the reveal policy
- **`learningHooks.test.ts`**
  - LH1: spy hooks receive exact payloads
  - LH2: `onAttemptRecorded` fires for submit, abandon and expire
  - LH3: completion hooks fire once on the first pass, and never on a fail, replay or rejection
  - LH4: returned `effects` appear in the response
  - LH5: a throwing hook → still 201, effects omitted, an error logged, progress committed
- **`progression.rules.test.ts`** (rules under content changes, done by direct DB edits until Phase 7)
  - PR1: unpublishing module 2 lets someone who passed 1 open module 3
  - PR2: moving an unpassed module ahead re-locks a started later module; its facts are kept
  - PR3: republishing keeps an earlier pass
- **`seedLearning.test.ts`**
  - SD1: an empty DB → 7 published modules (orders 1..7, positions contiguous), 7 quizzes of 5 questions (each with an explanation and a valid key), 1 final test of 15
  - SD2: a second run creates 0 and changes no document (`updatedAt` unchanged)
  - SD3: a partially seeded DB fills only the gaps
  - SD4: `NODE_ENV=production` → refuses
  - SD5: all content passes the authoring schemas
- **`rbac.denyByDefault.test.ts`**: B1 inventory, B2 (401 sweep covers the new routes), B3 (admin-only filter), new B7.

**The Phase 3 gate journey: `server/test/learning.journey.test.ts` (API level, D3-17).**
It uses the real seed and a real employee login, and reads the answer keys through the test-only DB
handle. Steps:
1. `GET /modules`: module 1 `unlocked`, 2..7 `locked`, final test `locked`.
2. **Locked module:** `GET /modules/{m2}` → 403 `MODULE_LOCKED`; `POST /modules/{m2}/quiz/sessions` → 403.
3. **Forged pass:**
   - `POST /modules/{m1}/quiz/attempts` with `{sessionId:<random>, answers:[], passed:true, score:100}` → 400
   - with a real session and `passed:true` → 400
   - `PATCH /me/progress` → 404
   - then `GET /modules` still shows m2 `locked`
4. **Failed quiz blocks progress:** complete the content of m1, start, submit 2/5 → 201 `passed:false`; m2 still `locked`; m2's quiz → 403.
5. **Passed quiz unlocks the next:** start, submit 5/5 → 201 `passed:true`, `moduleCompleted`, `nextModuleId = m2`; `GET /modules` shows m1 `completed` and m2 `unlocked`; m3 still `locked`.
6. **Replay:** resubmit step 5's body → 409; still exactly 2 attempts for m1.
7. Pass m2..m7 (interactive modules answer every exercise first); the final test becomes `unlocked` only after m7.
8. Final test: fail, then pass; the dashboard data shows 7/7 `completed` and the final test `completed`.
9. Deep scan: no response before a reveal contains `correctAnswer`, `correctIndex` or `explanation`.

## 13. Recommendation on the gate e2e (D3-17)
**Recommendation: the Phase 3 gate's e2e is the API-level journey test above. A Playwright UI
wiring is deferred to Phase 6.** Reasons:
- The renderer has no way to authenticate today: the preload bridge exposes only `appVersion` (asserted by `e2e/smoke.spec.ts`).
- ADR 0004 puts the refresh token in the main process with `safeStorage`, which is Phase 5 work.
- A "thin" wiring now would either hold tokens in the renderer (against ADR 0004) or pull Phase 5's bridge forward. It would also need a seeded backend in the Windows e2e CI job, which has no MongoDB today.
- The journey test proves every server-side claim in the gate wording: a locked module, a passed quiz, the next module unlocking, a failed quiz blocking progress, and a forged pass rejected. Phase 6's gate already demands the full UI journey.

This **deviates from the playbook's Phase 3 build prompt** ("wire the minimal module/quiz API into the
player and quiz UI"), so it needs explicit approval.

## 14. Risks
1. **No transactions.** Session claim, attempt insert, progress update and hooks are separate writes.
   - Worst cases: an attempt is lost (claimed but not inserted), or progress lags an inserted pass until the next submit.
   - It never grants an unearned pass.
   - Mitigations: ordered and idempotent writes (ADR 0007). If integrity demands it, add `MongoMemoryReplSet` and transactions later (Atlas supports them).
2. **Answer-key leakage through `select:false` on nested arrays.** Mongoose behaviour here is subtle.
   - Defence in depth: whitelist mappers, strict response schemas, deep-scan tests (ML1, MD1, QS1, journey step 9).
   - The security reviewer should target this.
3. **The RBAC sweep breaks on the first employee route.** B3 filters on `kind === 'role'`. Fix the filter as specified; do not weaken the assertion.
4. **The Phase 2 base is still moving.** `errors.ts`, `routes.ts`, `app.ts`, `env.ts`, `testConfig.ts` and the RBAC test are under review. Rebase before starting.
5. **The video gate depends on an honest client.** Documented as not a security boundary (ADR 0006).
6. **Unlimited retries plus right/wrong review** let persistent guessing pass. Mitigations: the reveal policy (D3-13) and Phase 4 basing Knowledge on first attempts.
7. **Reorder surprises** (a started module re-locks). Phase 7 must warn. The unique `order` index also makes swaps need a two-step update (Phase 7).
8. **Session TTL deletion** can drop never-closed sessions without an `expired` attempt (accepted, ADR 0007).
9. **Content volume.** 50 authored questions with explanations and 21 exercises is real writing work. Keep it generic; it is placeholder content pending the client's identity.
10. **Review text drift.** Reviews read the current question text. Phase 7 must block or version edits of published assessments.
11. **Hook failures are swallowed** (ADR 0008). Phase 4 needs monitoring and reconciliation.
12. **Desktop CSP** must allow the media host for video (Phase 5/6). The seed uses `media.example.com` placeholders that will not load.

## 15. Not requirement-backed (flagged for approval)
- `keyTakeaways`
- question shuffle
- session TTL and `ASSESSMENT_SESSION_TTL`
- QuizAttempt append-only enforcement
- strict response schemas and leak scans
- exercise feedback recorded server-side (derived from N2 plus "keys never leave the server")
- content-completion gate (derived from UI D7)
- warn-level logs for replays

## 16. Unchanged decisions reused
- U2 (Assessment discriminator `kind`), U3 (Answer shape, extended), U5 (one badge per module, untouched), U9 (format and minutes), U10 (index answer keys), U12 (single FinalTest)
- Phase 2 D-5 (per-request auth check), D-15 (zod in shared)
- Phase 1 D5, D6, D7

## 17. Decisions needed (recommended default in bold; each can be approved as is)
1. **D3-1 Module set.** **7 modules with the placeholder titles in §9; the count comes from data.** Product to confirm the 6 vs 7 open question.
2. **D3-2 Threshold location.** **`Quiz.passingScore` per module (default 70) and `FinalTest.passingScore` (default 70); no `Module.passThreshold`.** "3 of 5" = set 60.
3. **D3-3 Score rounding.** **`floor(100·correct/total)`; pass iff score ≥ threshold (exact).**
4. **D3-4 Unlock rule.** **Strict prefix over published modules; state derived, never stored; passes never revoked.**
5. **D3-5 Reorder after progress.** **Recompute, no grandfathering; passed stays completed; a started later module can re-lock (facts kept).**
6. **D3-6 Assignments.** **Phase 3 treats all published modules as assigned to every employee; the `curriculumFor` seam exists for Phase 7.**
7. **D3-7 Pre-quiz gate.** **Server-enforced content completion: all exercises answered (any answer) + a client-reported lesson complete.** Alternative: no server gate, UI only.
8. **D3-8 Exercise feedback.** **Served by `POST .../exercises/:id/answers`; keys and explanations are not shipped with content; first answer recorded.**
9. **D3-9 Attempt identity.** **Server-issued sessions (`.../sessions`), single-use submit to `.../attempts`; `GET .../quiz` is overview only.** This changes the contract.
10. **D3-10 Ordering.** **Shuffle question order per session; keep option order as authored.**
11. **D3-11 Leaving and expiry.** **Explicit abandon, starting anew while open, and expiry each count as a failed attempt (D5); session TTL 60 min (`ASSESSMENT_SESSION_TTL`, 5m..4h).**
12. **D3-12 Retries.** **Unlimited, no cooldown, for quizzes and the final test; an assessment closes once passed (409 `ALREADY_PASSED`, no practice retakes).**
13. **D3-13 Review reveal.** **On a failed attempt: your answer, right/wrong and the explanation; the correct option only once the assessment is passed. Abandoned and expired attempts: no review.** Alternative: always reveal the correct option, as the Phase 1 mock-up does.
14. **D3-14 Locked status.** **403 with `MODULE_LOCKED` / `FINAL_TEST_LOCKED`; 409 for `CONTENT_INCOMPLETE`, `ALREADY_PASSED`, `SESSION_CLOSED`, `SESSION_EXPIRED`.**
15. **D3-15 Final test.** **Unlocked iff the curriculum is non-empty and fully passed; all of its questions served (15 in the seed); threshold 70; retries per D3-12. `GET /final-test` returns 200 with an overview even when locked.**
16. **D3-16 `GET/PUT /admin/modules/:moduleId/quiz`.** **Deferred to Phase 7; content comes from the seed in Phase 3.**
17. **D3-17 Gate e2e.** **API-level journey test (supertest); UI wiring and Playwright in Phase 6.** This deviates from the playbook build prompt.
18. **D3-18 `/me` dashboard routes.** **Defer `/me/progress` and `/me/dashboard` to Phase 6 and `/me/badges` to Phase 4; `GET /modules` carries the progress overview now.**
19. **D3-19 Audit.** **No learning audit actions in Phase 3; warn logs for replays and expiry; Phase 4 decides.**
20. **D3-20 QuizAttempt immutability.** **Enforce append-only with a reusable plugin; do not refactor AuditLog now.**
21. **D3-21 Badge seed.** **Phase 4.**
22. **D3-22 Seed semantics.** **Dev/test only (refuses production); create-missing and keep-existing; `--reset` for dev.**
23. **D3-23 Transactions.** **None; ordered idempotent writes (risk 1).**
24. **D3-24 Hook failures.** **Caught and logged; the response is still 201 without effects; Phase 4 effects must be idempotent and reconcilable.**

## 18. Phase 3 acceptance checklist
**Setup**
- [ ] Phase 2 is merged to `main`; branch `phase-03-learning-engine` is cut from `main`; Conventional Commits; no direct commits to `main`.
- [ ] D3-1..D3-24 are answered; ADR 0006, 0007 and 0008 are set to Accepted (or amended).
- [ ] No new runtime dependencies; `npm audit --audit-level=high` is clean.

**Shared (pure rules)**
- [ ] `deriveModuleStates`, `deriveFinalTestState`, `gradeAttempt`, `validateAnswers`, `computeScore`, `isPass` and `revealPolicy` live in `@csense/shared` with UL1–UL11, GR1–GR7 and RV1–RV4 green, including the property tests.
- [ ] Request, response and authoring zod schemas are in shared and strict; SC1–SC5 are green; DTO types are inferred from the schemas.
- [ ] Six new error codes are added to `ERROR_CODES`, each with an `HttpError` factory.

**Data model**
- [ ] Module has captions, transcript, key takeaways and exercises; the publish invariant is enforced.
- [ ] Question has `explanation`; keys and explanations are `select:false` (ML1).
- [ ] UserProgress stores facts only (never `locked`/`unlocked`); `quizScore` is the best score; `attempts` counts every end reason.
- [ ] QuizAttempt has `sessionId` (unique), `endReason`, `attemptNumber`, counts and a threshold snapshot, and is append-only (ML3).
- [ ] AssessmentSession has one open session per user and assessment (partial unique) and a TTL; key snapshots are never serialised.

**API and rules**
- [ ] Exactly the 15 routes in §5 are added, all `EMPLOYEE_ONLY`. B1 inventory updated; the B3 filter is fixed (not weakened); B7 shows an admin token gets 403 on every employee route.
- [ ] Unlock invariant: a module is accessible iff every earlier published module is passed. Unpublished modules return 404 and are excluded. Reorder and unpublish rules hold (PR1–PR3).
- [ ] The quiz requires content completion; exercise feedback is immediate and server-side.
- [ ] Grading is server-side only from the session snapshot. Score is floored; pass uses the per-module `passingScore` (QG6).
- [ ] Unlimited retries; leaving, abandoning and expiry count as attempts; a passed assessment is closed.
- [ ] Review follows the reveal policy (QG2, QG3, MA4).
- [ ] The final test is locked until every curriculum module is passed, serves 15 seeded questions and uses its own threshold.
- [ ] Hooks: `onAttemptRecorded` per attempt; completion hooks exactly once; failures do not fail the submission (LH1–LH5).

**Tamper resistance**
- [ ] A forged pass, a locked-module submission, a cross-module session, unserved questions, a replay, a concurrent double submit, concurrent starts, an expired session, and cross-user session or attempt access all behave per §6 (TA1–TA9, CC1–CC3, MA2).
- [ ] No response leaks `correctAnswer`, `correctIndex` or `explanation` before it is allowed (deep scans and strict response schemas).

**Seed**
- [ ] `seed:learning` / `seed:learning:dev` creates 7 published modules, 7 quizzes of 5 and a final test of 15; it is idempotent, fills gaps, refuses production, and validates against the authoring schemas (SD1–SD5). No client branding.

**Gate**
- [ ] `learning.journey.test.ts` shows: a locked module (403), a failed quiz blocking progress, a passed quiz unlocking the next module, the server rejecting a forged pass (400/404, state unchanged), replay rejected (409), and the final test unlocking only after module 7.
- [ ] D3-17 is approved (API-level gate; UI wiring in Phase 6), or a thin UI wiring plan is added if rejected.

**Docs and Definition of Done**
- [ ] `contract.md` (routes, codes, deferrals, the `/me` note), `data-model.md`, `.env.example` (`ASSESSMENT_SESSION_TTL`) and the README (seed usage) are updated; the contract matches the B1 inventory.
- [ ] `npm run lint`, `typecheck`, `test`, `build` and `format:check` all pass; CI is green; the existing Phase 0–2 suites are still green.
- [ ] A security-tester review (focus: §6 and risk 2) has no open High or Critical findings; `/verify` passes.
