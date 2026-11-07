# ADR 0006: Learning progression, the unlock invariant and locked-resource responses

- Status: Accepted 2026-11-06 (Phase 3 plan, docs/architecture/phase-03-plan.md, decisions D3-4 to D3-7, D3-14)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)

## Context
The Client Needs require training as a sequence of locked modules: the next module unlocks only
after the current module's quiz is passed at the required score. Seven modules are assumed and the
pass threshold is configurable per module (default 70%). The Class UML gives `Module.order {unique}`,
`Module.isPublished`, `Module.unlockNext()`, `UserProgress.status/quizPassed` and
`UserProgress.unlockModule()`. Phase 7 will let administrators publish, unpublish, reorder and
assign modules after employees have made progress, so the rule must stay true under those changes.
The client is untrusted: the server must decide every lock.

The obvious implementation (store `locked`/`unlocked` on each UserProgress row and flip the next row
when a quiz is passed) breaks as soon as an administrator inserts, reorders or unpublishes a module:
stored flags go stale and a migration job is needed for every content change.

## Decision
1. **Facts are stored, lock state is derived.** UserProgress rows store facts only: the module was
   started (`in_progress`, `startedAt`), its content was completed, and its quiz was passed
   (`quizPassed`, `completedAt`, status `completed`). Rows are created on first interaction and are
   never written as `locked` or `unlocked`. Lock state is computed on every request by one pure
   function in `@csense/shared` (`deriveModuleStates`) from the current published curriculum and
   the employee's pass facts.
2. **The invariant is a strict prefix rule.** Order the employee's curriculum (published modules,
   ascending `order`; gaps in `order` are irrelevant). A module is accessible if and only if every
   module before it in that order is passed. The first unpassed module is the frontier
   (`unlocked`, or `in_progress` if started); unpassed modules after it are `locked`; passed modules
   are `completed` wherever they sit. "Module N+1 unlocks only when N's quiz is passed" is the
   special case where nothing changes.
3. **Passes are never revoked.** Reordering, inserting or republishing never turns a passed module
   back into a locked or incomplete one, so earned XP and badges (Phase 4) stay valid.
4. **Unpublished modules are outside the sequence.** They neither block nor count. Their ids return
   404 to employees (drafts are not disclosed). Pass facts on an unpublished module are kept and
   count again if it is republished.
5. **Reordering after progress (Phase 7) recomputes; nothing is grandfathered.** If a module the
   employee has not passed moves ahead of their frontier, it becomes their next required module and
   later unpassed modules (including one they had started) lock until it is passed. Their stored
   facts (started, exercise answers, attempts) are kept for when it unlocks again.
6. **Assignments (Phase 7) are a filter on the curriculum.** Phase 3 treats every published module
   as assigned to every employee. All lock decisions go through one seam,
   `curriculumFor(userId)`, which Phase 7 changes to filter by assignment. Nothing else changes.
7. **The final assessment** is accessible if and only if the curriculum has at least one module
   and every module in it is passed. An empty curriculum never unlocks it.
8. **Pre-quiz content gate.** A module's quiz can start only after its content is complete: every
   exercise in the module has a recorded answer (any answer) and the client has reported the lesson
   complete. Video completion is reported by the client and cannot be verified by the server; this
   gate stops a well-behaved client from skipping content. It is not a security boundary.
9. **Locked resources return 403 with a specific code**, not 423. The codes are `MODULE_LOCKED` and
   `FINAL_TEST_LOCKED`; wrong role stays `FORBIDDEN`. 423 Locked (RFC 4918, WebDAV) means a
   resource is locked against concurrent modification. Here the server understands the request and
   refuses it for this caller until a precondition is met, which is what 403 means. Clients tell the
   cases apart by `error.code`. 409 is used for state conflicts that are not about sequence
   (`CONTENT_INCOMPLETE`, `ALREADY_PASSED`, `SESSION_CLOSED`, `SESSION_EXPIRED`).

## Consequences
- Positive:
  - The invariant holds under any admin content change with no migration jobs.
  - The rule is one pure function, unit-testable exhaustively and reusable by the desktop.
  - Admin queries on `{moduleId, status}` still work for `in_progress` and `completed`.
- Negative:
  - Every curriculum read costs a few small queries: published modules, the user's progress rows,
    quiz summaries and the final test. That is fine for 7 modules; revisit if curricula grow large.
  - An employee can lose access to a module they had started after a reorder. Phase 7's reorder UI
    must warn about this.
  - The content gate relies on an honest client for video. A hostile client can skip the video but
    still has to pass the quiz.
  - `UserProgress.status` stored in the DB is not the employee-visible status. Code that reads
    status must call the derivation function, never the raw field (tested).
