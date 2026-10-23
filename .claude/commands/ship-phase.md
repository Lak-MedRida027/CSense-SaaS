---
description: Close out the current phase - summarise the diff, update docs, run the gate, and prepare a conventional commit + PR description.
allowed-tools: Bash, Read, Edit, Grep, Glob
argument-hint: <phase-number-and-name, e.g. "02 backend-auth">
---

Close out phase $ARGUMENTS. Steps:

1. Show `git status` and a concise summary of what changed and why (group by area).
2. Confirm the phase's Definition of Done: lint, typecheck, tests, build all green, no high/critical
   `npm audit`, and `.env.example` + relevant docs updated. If anything is missing, list it and stop.
3. Propose a Conventional Commits message for this phase.
4. Draft a PR description: what shipped, how it was verified, which requirements it satisfies, and
   any open follow-ups or decisions still needed.

Do not push or merge. Leave me the commit message and PR text to approve.
