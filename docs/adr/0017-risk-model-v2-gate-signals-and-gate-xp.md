# ADR 0017: Risk model v2 (gate signals in Behavioural) and gate XP

- Status: Accepted 2026-11-10 (Phase 5 plan section 6.9, decisions D5-9, D5-10)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval)
- Amends: ADR 0010 (Behavioural, model version), ADR 0009 (XP sources)

## Context
ADR 0010 and D4-9 reserved a Behavioural blend of gate 70 / conduct 30 for model v2, once Phase 5 produces gate data. ADR 0009 and D4-1 made Defender (3,500 XP) unreachable from the course alone (maximum 2,970), on purpose: Defender should mean sustained behaviour, with the Phase 5 gate as a source. Both projects require pure, rebuildable functions of append-only facts in `@csense/shared`, integer arithmetic and `roundHalfUp`.

## Decision
1. **Gate facts:** the employee's last 20 closed gate runs (`passed` or `restricted`, `firstAnswerCorrect`, `closedAt`), loaded from `gateruns` and `gateanswers`.
2. **Gate score** (0..100, higher is riskier):
   - `n = 0`: null
   - otherwise `min(100, roundHalfUp(100·w, n) + 35·min(r, 2))`, where w = runs whose first answer was wrong and r = restricted runs
3. **Behavioural v2:**
   - if both the gate score and the v1 Behavioural (conduct plus cooldown penalty) exist: `roundHalfUp(70·gate + 30·v1, 100)`
   - if only one exists: that one
   - otherwise null (not assessed)
4. **`RISK_MODEL_VERSION = 2`.** New `RiskTrigger` `gate_run`. The fact digest includes the gate runs. Roll-out runs `gamification:reconcile --all` (trigger `model_upgrade`). Resulting level changes are audited and escalated as usual (D4-25).
5. **Gate XP:** `gate_daily_check`, 10 XP per organisation-local calendar day (`ORG_TIMEZONE`, default UTC, key `gate:<date>`), earned only by a passed run whose first answer was correct. It is computed by `computeXp`, so it is monotone and idempotent.
   - After a perfect course (2,970), Defender needs about 53 such days.

## Consequences
- Positive: the gate now measures day-to-day behaviour. Defender becomes reachable through sustained correct behaviour and cannot be farmed (one award per day, one run per clearance). The model stays explainable and versioned.
- Negative:
  - The constants (window 20, 35 points, cap 2, 10 XP) are product judgements and provisional, like D4-9.
  - The v2 roll-out shifts Behavioural for every employee with gate data and may move some into High, so announce it to the security team.
  - Org-day XP depends on a correct `ORG_TIMEZONE`.
