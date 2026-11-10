# ADR 0010: Risk model v1. Direction, sub-score sources, missing dimensions and bands

- Status: Accepted 2026-11-07 (Phase 4 plan, docs/architecture/phase-04-plan.md, decisions D4-6 to D4-12, D4-23 to D4-25)
- Date: 2026-11-06
- Deciders: Technical architect, product owner (approval), security-tester (review)

## Context
CLAUDE.md fixes the composite: Knowledge 30% + Behavioural 25% + Simulation 30% + Engagement 15%, bands
Low/Medium/High mapped to Green/Amber/Red, logic pure in `/shared`. `shared/src/constants/risk.ts` has
the weights and the mapping; band cut-offs and score direction were left open (U7). The Phase 1 UI
treats the composite as "higher = riskier" (fixtures: 72 High; 55 and 44 Medium; 28 Low), which fits
bands 0-39 / 40-69 / 70-100. The fixture sub-scores are not consistent with any single direction
(Knowledge and Engagement read as "good when high", Simulation and Behavioural as "bad when high").

Data available by phase:
- Phase 3: append-only `QuizAttempt` history (attempt number, end reason, correct and total counts,
  pass), `UserProgress` (passes, exercise answers), the published curriculum.
- Phase 5: security-gate interactions (checks, failed answers, restricted access).
- Flag `FEATURE_PHISHING` (default off): simulation outcomes. No data model yet.

So in Phase 4 Simulation has no data for anyone, and Behavioural has no gate data.

## Decision
1. **One direction.** Every stored sub-score and the composite are risk scores: integers 0..100,
   0 = no observed risk, 100 = maximum risk. The composite is a plain weighted sum, so each bar in the
   breakdown reads "longer = riskier". UML field names (`knowledgeScore`, ...) are kept; their meaning
   is documented. The Phase 1 fixtures are illustrative and get corrected in Phase 7.
2. **Integer arithmetic.** Weights are held as basis points `{3000, 2500, 3000, 1500}` (asserted equal
   to `RISK_WEIGHTS x 10000`). Every division uses `roundHalfUp(num, den) = floor((2*num + den) / (2*den))`
   on non-negative integers. No floating-point results reach a band decision.
3. **Sub-scores (v1):**
   - **Knowledge** = share of questions answered wrongly on **first attempts**: over every assessment
     (module quizzes and the final test) the employee has attempted, take the attempt with
     `attemptNumber === 1`; `C = sum(correctCount)`, `T = sum(totalCount)`;
     `knowledge = roundHalfUp(100 * (T - C), T)`. An abandoned or expired first attempt counts as
     0 correct of the questions served (otherwise abandoning would preview questions for free). The
     final test weighs three times a quiz because it serves 15 questions. Retries never improve it.
   - **Behavioural** = blend of signal groups. v1 has one group, **assessment conduct**:
     `abandonRate = (abandoned + expired) / attempts` (leaving secure quiz mode) and
     `retryRate = min(1, extraFailures / (3 * assessmentsAttempted))` where `extraFailures` counts
     failed *submitted* attempts beyond the first per assessment (guessing loops);
     `conduct = roundHalfUp(100 * (abandonRate + retryRate), 2)` computed on exact fractions.
     Phase 5 adds the gate group and blends gate 70 / conduct 30 (model v2).
   - **Simulation** (flag only) = mean outcome points over the last 5 delivered simulations:
     reported 0, no action 25, clicked then reported 50, clicked 75, credentials submitted 100.
   - **Engagement** = share of the current curriculum not yet completed:
     `N = published modules + (final test exists ? 1 : 0)`, `D = passed curriculum modules + (final passed ? 1 : 0)`,
     `engagement = roundHalfUp(100 * (N - D), N)`. No wall-clock decay until Phase 7 adds due dates, so
     a recomputation from the same facts always gives the same result.
4. **Missing dimensions are excluded and the remaining nominal weights are re-normalised**, never
   scored as 0 (perfect) or 50 (invented). Each dimension carries a coverage flag: `assessed`,
   `not_assessed` (no data yet) or `disabled` (Simulation while `FEATURE_PHISHING` is off).
   `composite = roundHalfUp(sum(w_i * s_i), sum(w_i))` over assessed dimensions. With Simulation
   disabled the effective weights are 42.86 / 35.71 / 21.43 (Knowledge / Behavioural / Engagement),
   proportional to 30 / 25 / 15. The nominal weights stay fixed and are what the tests assert; the
   effective weights and coverage are stored and returned so every score is explainable.
5. **Minimum evidence.** A profile is classified only when Knowledge has first attempts on at least
   `min(2, N)` assessments. Before that, `riskLevel` and `compositeScore` are `null` ("Not assessed",
   which the UI already supports); sub-scores are still stored for transparency.
6. **Bands.** `classifyRisk(composite)`: 0-39 Low (Green), 40-69 Medium (Amber), 70-100 High (Red),
   integers only; anything else throws. The 39/40 and 69/70 boundaries and the half-up rounding at
   39.5 and 69.5 are unit-tested exactly.
7. **Versioning and history.** `RISK_MODEL_VERSION = 1` is stored on every profile and history entry.
   An append-only `riskassessments` entry is written whenever a recomputation changes a sub-score,
   coverage, the level or the model version, with the evidence counts and a SHA-256 digest of the
   canonical inputs. A model change is rolled out with the reconcile command; its level changes are
   audited and escalated like any other.
8. **Employees never see their own risk** (Phase 1 D17). Only administrators read profiles.

## Consequences
- Positive: one readable formula per dimension, exact and deterministic; no dimension is silently
  treated as perfect or as average; switching phishing on, or Phase 5 adding gate data, needs a version
  bump and a rebuild, not a schema change; history makes every escalation traceable to its inputs.
- Negative: while Simulation is disabled, Knowledge carries ~43% of the composite, so scores are not
  comparable across periods with different coverage (coverage is shown next to each score). The
  conduct formula and its constants (3 extra failures per assessment, 50/50) are a product judgement,
  not an empirical model; they are named constants with tests and marked provisional. Engagement
  penalises employees part-way through the course until due dates exist (Phase 7). Knowledge does not
  improve after the course until continuous review (flag) adds new first attempts.

## Amendments (implementation, Phase 4)
- First attempt means the attempt with the lowest `attemptNumber` per assessment (earliest `attemptedAt` on a tie); the model never assumes an attempt numbered 1 exists. The same rule decides the XP first-try bonus (the passing attempt is the first attempt).
- Behavioural v1 also reads the `learning.assessment.cooldown` audit entries written by Phase 3: each cooldown adds 25 points to the conduct score, at most two count, capped at 100. The model stays at version 1 because it has not been released.

## Amendment (disengagement, Phase 4 safeguard P4-L5)
"Not assessed" is not a safe place to hide: an employee who never takes two quizzes stays unclassified and can never reach High. An **active employee whose profile is still not assessed `DISENGAGED_AFTER_DAYS` (default 14) after their account was created** therefore opens an elevated `disengaged_unassessed` escalation for the security team. Time passing is the trigger, so it is evaluated in a periodic sweeper scan (bounded: at most 1000 employees per sweep in pages of 200, indexed on `{role, isActive, createdAt}`, no recompute per employee), on each risk recompute and in `gamification:reconcile`. There is at most one per employee for good (fixed dedupe key): it is never auto-resolved, not even once the employee becomes assessed, and not reopened after an administrator resolves it. Deactivated employees, administrators and a database with no published module are never flagged. The model version is unchanged: this is governance, not a score.

## Amendment (stalled employees, Phase 4 re-review P4-L12)
Becoming assessed is not the end of the story: two first attempts classify an employee, and an employee who then stalls would be invisible (Medium never escalates, Engagement is only 15 %). The disengagement rule therefore covers every active employee whose curriculum is unfinished and who has made no progress for `DISENGAGED_AFTER_DAYS` (default 14): reason `disengaged_unassessed` while not assessed, `disengaged_no_progress` once assessed. Progress is the latest of account creation, module start, exercise answer, content completion, any attempt, and the resolution of an earlier flag, so an administrator resolution gives the employee a fresh period and a later stall can be flagged again. At most one flag is active per employee. This is governance, not a score: model version unchanged.
