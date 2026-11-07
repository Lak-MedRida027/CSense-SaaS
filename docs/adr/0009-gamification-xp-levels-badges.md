# ADR 0009: Gamification. XP is derived from history; levels are thresholds; badges are permanent awards

- Status: Accepted 2026-11-07 (Phase 4 plan, docs/architecture/phase-04-plan.md, decisions D4-1 to D4-5)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval)
- Builds on: ADR 0006 (passes are never revoked), ADR 0007 (attempt history, unlimited retries), ADR 0008 (learning hooks seam)

## Context
The Client Needs require XP, a five-tier ladder (Apprentice, Aware, Practitioner, Guardian, Defender)
and a named badge awarded automatically on each module completion. The use-case diagram has Award
Badge extending Complete Learning Module. Phase 3 made retries unlimited (D3-12), counted abandons and
expiries as attempts (D5, ADR 0007), and delivers learning events through `LearningHooks` (ADR 0008).
ADR 0008 requires Phase 4 effects to be idempotent and rebuildable from the attempt history, because a
hook failure is swallowed and a hook can in principle run twice (reconcile, redelivery).
`Employee.totalXP` and `Employee.level` already exist (Class UML). The Phase 1 UI proposes the XP
ladder 0 / 300 / 900 / 2000 / 3500 (fixtures; decision U8/D9 still open). `shared/levels.ts` has the
names only.

Two common designs fail here:
- **Per-event increments** (`$inc totalXP` on every pass): a replayed or reconciled event double-counts,
  and there is no way to prove what the total should be.
- **XP per attempt**: unlimited retries make it farmable.

## Decision
1. **XP is a pure function of facts.** `computeXp(facts)` in `@csense/shared` takes the employee's
   module and final-test facts (first attempt, passing attempt, first-answer exercise correctness) and
   returns `{ total, entries[] }`. Each entry has a deterministic key (`module:<id>:completion`,
   `module:<id>:first_try`, ...), so an award can exist at most once by construction. No XP is ever
   granted per attempt; failed, abandoned and expired attempts earn nothing. 100 failures followed by a
   pass earn exactly what one failure followed by a pass earns.
2. **XP rules (v1)**, in `XP_RULES` (shared, frozen):
   | Source | XP | Condition |
   |---|---|---|
   | Module completion | 150 | module quiz passed (once per module, forever) |
   | First-try bonus | 100 | the passing attempt has `attemptNumber === 1` (an abandoned or expired first attempt forfeits it) |
   | Perfect bonus | 50 | the passing attempt scored 100 |
   | Practice | 10 per exercise | first recorded answer was correct; credited when the module is completed |
   | Final assessment completion | 400 | final test passed |
   | Final first-try bonus | 200 | passing final attempt has `attemptNumber === 1` |
   | Final perfect bonus | 100 | passing final attempt scored 100 |
   With the seeded curriculum (7 modules, 17 exercises) the maximum from learning is 2,970 XP
   (Guardian). Defender (3,500) needs post-curriculum behaviour XP added in Phase 5 (security-gate
   checks) and behind flags (phishing reports, continuous review). This is deliberate: Defender means
   sustained behaviour, not one course (decision D4-1).
3. **Level thresholds** live in `shared/src/constants/levels.ts` as `LEVEL_THRESHOLDS`
   `{ Apprentice: 0, Aware: 300, Practitioner: 900, Guardian: 2000, Defender: 3500 }`, adopted from the
   Phase 1 proposal. `levelForXp(xp)` and `levelProgress(xp)` are pure functions; the UI receives
   thresholds from the API, never hard-codes them.
4. **Persistence is a monotone projection.** `Employee.totalXP` and `Employee.level` are a cache of
   `computeXp`. The update is conditional and monotone:
   `updateOne({ _id, totalXP: { $lt: T } }, { $set: { totalXP: T, level: levelForXp(T) } })`.
   Facts only accumulate (attempts are append-only, passes are never revoked), so concurrent or stale
   recomputations can never lower XP or leave the level out of step with the total. A rule change that
   lowers XP is applied only by the reconcile command with `--force-xp`.
5. **Badges.** One badge per module (U5, unique `Badge.moduleId`). Awards are stored in a new
   append-only collection `badgeawards` (the UML "Employee earns Badge" association), unique on
   `{ userId, badgeId }`. The award is an insert; a duplicate-key error means "already awarded" and is
   success. Awards are permanent, including for modules later unpublished or reordered (ADR 0006).
   No badge for the final assessment (`Badge.moduleId` is required by the UML); its reward is XP.
   If a module has no badge when it is completed, nothing is awarded and a warning is logged; the
   reconcile command awards it retroactively with `awardedAt` = the module's `completedAt`.
6. **Event wiring (ADR 0008).** `onModuleCompleted` awards the badge, then recomputes XP;
   `onFinalTestPassed` recomputes XP. `effects.xpEarned` is the sum of the entries attributable to the
   event's `attemptId` (not a before/after delta), so it is stable under races and redelivery.
7. **Reconcile.** `gamification:reconcile` (CLI) and an in-process sweeper rebuild badges and XP from
   history for one or all employees; a second run changes nothing.

## Consequences
- Positive: no XP farming; exactly-once badges proved by a unique index; totals are reproducible and
  defensible ("here are the facts and the rule table"); hook failures are repairable.
- Negative: each completion reads the employee's attempt history (small: tens of documents). Changing
  XP values later needs a forced rebuild and changes visible totals. Defender is unreachable until
  Phase 5 or a flag adds behaviour XP; if product wants Defender reachable from the course alone, only
  the table in `XP_RULES` changes.
- Follow-ups: Phase 5 adds gate XP sources (new entry keys); Phase 7 adds `/admin/badges` CRUD and must
  run the reconcile after creating a badge for an already-completed module.
