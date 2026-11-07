# ADR 0007: Assessment sessions, server-side grading and answer-key confidentiality

- Status: Accepted 2026-11-06 (Phase 3 plan, docs/architecture/phase-03-plan.md, decisions D3-8 to D3-13)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)

## Context
Each module has a multiple-choice quiz with a pass threshold. The employee can review answers and
retry after a failure. A final assessment of about fifteen questions follows the modules.
Phase 1 decision D5 says that leaving a quiz part-way counts as an attempt. The quiz UI shows
"attempt N" on the intro and reveals correct answers and explanations in a review phase. The
playbook gate requires the server to reject a forged pass.

A stateless "GET questions, POST answers" design cannot:
- count an abandoned quiz (the client simply never posts)
- prove which questions were served
- stop a replayed submission

The Class UML defines `QuizAttempt` as the graded record and `Assessment.grade(answers): int`.

## Decision
1. **Server-issued assessment sessions.** Starting a quiz or the final test
   (`POST .../sessions`) creates an `AssessmentSession`. The session:
   - stores the served question ids in served order, with a snapshot of each answer key
     (`select: false`) and option count
   - stores the pass threshold at start, `startedAt` and `expiresAt` (`ASSESSMENT_SESSION_TTL`, default 60 min)
   - returns the questions **without answer keys or explanations**

   `GET /modules/:id/quiz` and `GET /final-test` return only an overview (count, threshold, attempts,
   best score, availability). Questions are delivered only by starting a session.
2. **Single-use, atomic submission.** Submitting (`POST .../attempts` with `{sessionId, answers}`)
   runs in this order:
   1. Validate the answers against the session's served set.
   2. Grade with the snapshot key.
   3. Claim the session with one conditional update (`status: 'open'` and not expired →
      `submitted`).
   4. Insert one append-only `QuizAttempt` carrying a **unique `sessionId`**.

   A replayed or concurrent second submission loses the claim and gets 409 `SESSION_CLOSED`. The
   unique index is a second guard. A session that belongs to another user, or to another
   assessment than the route, is 404.
3. **Every attempt counts, including leaving.** These all write a `QuizAttempt` with score 0 and
   `passed: false`:
   - an explicit abandon (`POST .../sessions/:id/abandon`, the D5 "Exit quiz" path), with
     `endReason: 'abandoned'`
   - starting a new session while one is open, which closes the old one as `abandoned`
   - submitting after expiry, with `endReason: 'expired'` and 409 `SESSION_EXPIRED`

   At most one open session exists per employee per assessment (partial unique index). Two further
   guards (amended after the Phase 3 security review):
   - The unique indexes are built and verified at startup (the API refuses to start without them)
     and `/health/ready` reports `unavailable` if one is missing. As a second guard, after creating
     a session the service keeps the lowest-id open session for the pair and closes any other.
   - Starting a session is throttled per employee (`SESSION_START_RATE_MAX` per
     `SESSION_START_RATE_WINDOW_MS`, 429 `RATE_LIMITED`), and a start repeated within
     `ASSESSMENT_START_REUSE_SECONDS` returns the open session instead of abandoning it, so a
     double click or a retry cannot burn an attempt or flood the append-only history.
4. **Grading is a pure function** in `@csense/shared` (`gradeAttempt`):
   - `score = floor(100 * correct / served)`
   - `passed = score >= passingScore`, which is equivalent to the exact comparison
     `100 * correct >= passingScore * served` for an integer threshold, so rounding never turns a fail into a pass
   - unanswered questions count as wrong and are recorded with `selectedIndex: null`
   - unknown or duplicate question ids and out-of-range indices are rejected (400) before the
     session is consumed
   - the request body has no `score`, `passed` or `correct` fields; strict zod rejects them (400)
5. **Question pool and cooldown (P3-M1).** The reveal policy below tells a failed attempt which questions were right. With stable question ids, a fixed option order and unlimited retries that is a key oracle: a client that keeps right answers and rotates wrong ones passes any quiz in at most as many attempts as it has options per question, knowing nothing. The product owner decided to keep the per-question feedback and close the oracle with two mechanisms instead:
   - **Pool.** An assessment holds a pool and serves `questionsPerSession` of it (a quiz serves 5 from at least 10, the final test 15 from at least 30; a published pool holds at least twice the questions served, checked by the authoring schema and the shared authoring check). A session prefers questions the employee has not been served in earlier attempts (read from the append-only history), then the least recently served; the draw inside each tier is random through the injectable shuffle (`selectQuestionIds`, pure and in `@csense/shared`). Grading, validation and the review use the session snapshot, so only served questions are graded and, after a pass, only served questions have their correct option revealed. The pass threshold is applied to the served count.
   - **Cooldown.** After `ASSESSMENT_COOLDOWN_AFTER_FAILS` (default 3) consecutive failed attempts at one assessment (abandoned and expired attempts count, D3-11; a pass resets the streak) new sessions for it are refused with 409 `ASSESSMENT_COOLDOWN`, a `Retry-After` header and `details.retryAt`, until `ASSESSMENT_COOLDOWN_MINUTES` (default 15) have passed. The streak lives in the per-(employee, assessment) ledger and is advanced by one atomic update; a conditional update starts the cooldown, so failures that race start exactly one and skip none. The streak restarts from zero when a cooldown starts. Each cooldown writes a `warning` audit entry (`learning.assessment.cooldown`: actor and target the employee, the assessment id and the length of the streak, no answers or scores). Phase 4 feeds these entries into the Behavioural risk dimension and escalations. The overview DTOs expose `cooldownUntil`.
   - Residual risk, accepted: an adversary willing to spend days can still accumulate knowledge across cooldowns, but only about three attempts per window, mostly on questions they have not seen.
6. **Answer keys never leave the server before they are earned:**
   - Exercise feedback (correct index and explanation) is returned only by
     `POST .../exercises/:id/answers`, after the employee has answered.
   - Quiz and final-test review follows a reveal policy, also a pure shared function:
     - after a **failed** attempt: the employee's answer, right or wrong per question, and the explanation
     - after the assessment is **passed**: also the correct option, for every attempt of it
   - Authoring guideline: explanations teach the concept without naming the correct option.
7. **Ordering:** question order is shuffled per session (stored in the session); option order is
   fixed as authored. This keeps "All of the above" options valid, and the review matches what was shown.
8. **Retries:** unlimited in number, but limited in rate by the cooldown (decision 5), for quizzes and the final test (the quiz UI has an attempt
   number, not an attempts-remaining indicator; the limited-attempts indicator belongs to the
   security gate). A passed assessment is closed: new sessions return 409 `ALREADY_PASSED`.
9. **No transactions** (the deployment and the test harness use standalone MongoDB). Writes are
   ordered, and each one is atomic and idempotent or conditional:
   1. At session start the attempt number comes from a per-(employee, assessment) ledger
      (`AttemptCounter`, atomic `$inc`) and is stored on the session. Attempts have a unique index
      on `{userId, refId, attemptNumber}`.
   2. Submit claims the session, re-checks `ALREADY_PASSED`, grades, and inserts the attempt.
   3. The ledger counts the attempt and decides the first pass with a conditional write
      (`firstPassAt` still null). Only that write makes a completion hook fire, so it fires once
      even when two passing submissions race.
   4. Progress is updated (`$inc`, `$max`, first-pass `$set`). Once the attempt is saved no failure
      returns 500: each write is retried once and then logged.
   5. The hooks run, each with a time limit (ADR 0008).

   The append-only attempt history is the record of truth. A module with a stored passing attempt
   counts as passed on every read (`loadLearningState` patches the progress and repairs the stored
   row), so a lost progress write cannot hide a pass, and the closed quiz cannot be completed a
   second time. The worst partial failure loses one attempt or delays a progress update until the
   next read. It never credits a pass that was not earned.
10. **Append-only is enforced for aggregation too.** Update, replace, delete, `bulkWrite` and
   aggregation pipelines containing `$merge` or `$out` are all rejected on `QuizAttempt` and
   `AuditLog`. The driver or a database user with write rights can still bypass this (Phase 10:
   restrict the database role).

## Consequences
- Positive:
  - Forged passes, replays, double submits, answers for unserved questions and cross-user session
    use all fail on server state, not client honesty.
  - Abandoning is counted as D5 requires.
  - Grading is deterministic and exhaustively testable.
  - Admin edits during a session (Phase 7) cannot change how that session is graded.
- Content quality is part of confidentiality: the explanation is shown after a failed attempt, so
  authored items are checked (`checkAuthoringSet` in `@csense/shared`, reused by Phase 7) for
  explanations that repeat the correct option's wording, a correct option that is too often the
  longest, and near-duplicate questions. The seed passes the same check in its test.
- Negative:
  - Attempt numbers can skip: a session that is closed silently by the duplicate-session guard, or
    deleted by TTL, never produces an attempt.
  - The API has more routes than the original contract (sessions and abandon). `GET .../quiz` no
    longer carries questions; the contract is updated.
  - Answer keys exist in a second collection (sessions). They are `select: false`, never
    serialised, and removed by TTL 30 days after expiry.
  - An open session that is never resumed or closed is deleted by TTL without an `expired` attempt
    being written. This is accepted: that employee cannot progress without returning, and returning
    closes the session.
  - Withholding correct options on a failed attempt departs from the Phase 1 review mock-up. The UI
    already treats `correctOptionId` as optional.
  - Unlimited retries plus right/wrong review make a later pass likely. Phase 4 should base the
    Knowledge score on first-attempt results, which the attempt history preserves.
