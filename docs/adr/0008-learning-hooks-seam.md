# ADR 0008: Learning hooks, the seam between the learning engine and gamification/risk

- Status: Accepted 2026-11-06 (Phase 3 plan, docs/architecture/phase-03-plan.md, decision D3-24)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval)

## Context
The use-case diagram has "Complete Learning Module" extended by "Award Badge", and both "Take
Module Quiz" and "Take Final Assessment" include "Update Risk Profile". The contract says completion
and badge award are server-side effects of a passing attempt, never a client call. Phase 4 builds XP,
levels, badges and the risk engine. Phase 3 must leave a seam Phase 4 can fill without reopening
grading code. The quiz result screen already shows `xpEarned` and `badge`.

## Decision
- The learning engine depends on an injected `LearningHooks` interface (in
  `server/src/features/learning/learningHooks.ts`), not on a global event emitter:
  ```ts
  interface LearningHooks {
    onAttemptRecorded(e: AttemptRecordedEvent): Promise<AttemptEffects | undefined>;
    onModuleCompleted(e: ModuleCompletedEvent): Promise<AttemptEffects | undefined>;
    onFinalTestPassed(e: FinalTestPassedEvent): Promise<AttemptEffects | undefined>;
  }
  type AttemptEffects = { xpEarned?: number; badge?: { id: string; name: string; iconMotif: string } };
  ```
- `onAttemptRecorded` fires once per `QuizAttempt` (submitted, abandoned or expired).
  `onModuleCompleted` and `onFinalTestPassed` fire **exactly once** per employee and assessment, on
  the first pass. "First" is decided by one conditional write on the per-(employee, assessment)
  ledger (`firstPassAt` still null), for the quiz and the final test alike, never by the client and
  never by a check made before the insert. It does not depend on the progress write, which may be
  retried or repaired separately (ADR 0007).
- Hooks run after the attempt and progress writes. The submit handler awaits them sequentially and
  merges their `AttemptEffects` into the response's `effects` object.
- Phase 3 ships `noopLearningHooks`. `createApp` accepts `learningHooks` in `AppOptions` (default
  noop), so tests can inject spies.
- Time limit: each hook runs under `LEARNING_HOOK_TIMEOUT_MS` (default 2000 ms, range 100 to
  30000). A hook that exceeds it is logged at `error` level and its effects are dropped; the
  response returns with the attempt saved. A late rejection is swallowed so it cannot crash the
  process. Hooks must therefore be idempotent and reconcilable, because a timed-out hook may still
  finish in the background. Only `xpEarned` and `badge` from a hook reach the response.
- Failure semantics: a hook error is caught and logged at `error` level with the request id, and the
  response is still 201 with the hook's effects omitted. The attempt is already committed and must
  not be reported as failed. Phase 4 must make its effects idempotent and reconcilable from the
  attempt history: for example, unique `{userId, badgeId}` and XP recomputable from attempts. If
  Phase 4 needs fail-closed behaviour, for instance for escalation audit writes, it must do that work
  inside its own reconcilable process, not by failing the employee's submission.

## Consequences
- Positive: grading code is finished in Phase 3; Phase 4 replaces one object; tests can assert the
  exactly-once semantics today with spies; no hidden listeners or ordering surprises.
- Negative: hook latency adds to the submit request. Swallowed hook errors need monitoring and a
  reconciliation path in Phase 4. An emitter would make fan-out easier, but its errors are
  fire-and-forget and harder to test.
