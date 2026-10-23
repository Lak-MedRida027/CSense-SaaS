---
description: Run the full verification gate for the current phase (lint, typecheck, tests, build, audit) and report pass/fail per check.
allowed-tools: Bash, Read, Grep, Glob
argument-hint: [optional phase name or area, e.g. "server auth"]
---

Run the verification gate for the current work$ARGUMENTS. Do each step, capture the result, and do
not stop at the first failure - report every check so I see the full picture:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test` (unit + integration)
4. `npm run build`
5. `npm audit --audit-level=high`

Then print a compact table: check | pass/fail | key detail. For any failure, give the root cause in
one line and the most likely fix. End with a single verdict: GATE PASSED or GATE BLOCKED, and if
blocked, the ordered list of what must be fixed. Do not change code in this command - just verify.
