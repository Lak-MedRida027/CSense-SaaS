# ADR 0012: Tamper-evident audit log with a keyed hash chain

- Status: Accepted 2026-11-07 (Phase 4 plan, docs/architecture/phase-04-plan.md, decision D4-18)
- Date: 2026-11-06
- Deciders: Technical architect, security-tester (review), product owner (approval)
- Resolves: ADR 0005 "tamper evidence (hash chaining) is a Phase 4 decision"

## Context
`auditlogs` is append-only at the Mongoose level (ADR 0005). The raw driver, a database user with write
rights, or anyone with database access can still edit or delete entries without trace. Phase 4 starts
writing the records that matter most for ISO/IEC 27001:2022 (A.5.28 evidence, A.8.15 logging): risk
escalations and the organisation's responses. Restricting the application's database role to
insert and find comes in Phase 10. The service is a single API instance today (in-memory rate limits,
ADR 0004), but nothing should break if a CLI process (bootstrap, reconcile, verify) writes at the same time.

Options considered:
1. **Plain SHA-256 chain.** Anyone with database write access can recompute it after tampering, so it detects
   accidents but not a deliberate edit.
2. **Per-entry HMAC without a chain.** Detects edits, but not deletions or reordering.
3. **Keyed chain (HMAC over the entry and the previous hash) with a dense sequence.** Detects edits,
   deletions inside the chain and reordering. Forging it needs the key, which is not in the database.
4. **External anchoring or WORM storage** (cloud object lock, a transparency log). Strongest, but it
   needs infrastructure that belongs to Phase 10.

## Decision
Adopt option 3 now; plan option 4 as a Phase 10 hardening.
- New AuditLog fields: `seq` (int >= 1, unique), `prevHash` (64 hex; the genesis value is 64 zeros),
  `hash` (64 hex), `idempotencyKey` (string up to 200 or null, unique when present).
- `hash = HMAC-SHA256(AUDIT_CHAIN_SECRET, canonical(entry))`. `canonical` is a JSON array in a fixed field order:
  `[1, seq, prevHash, createdAt ISO-8601, action, outcome, severity, actorId, actorRole, targetType,
  targetId, ip, userAgent, requestId, idempotencyKey, metadata]`, where `metadata` is serialised with
  keys sorted recursively. Metadata values are restricted to JSON types (Dates become ISO strings in the
  sanitiser before hashing), and are stored exactly as hashed. `createdAt` is set by the service from the
  injected clock before hashing.
- **Writer.** `audit.record` is the only writer. Under an in-process mutex it reads the tip
  (`seq`, `hash`), computes the entry and inserts it. A duplicate key on `seq` (another process won)
  re-reads the tip and retries up to 5 times, then fails (HTTP paths fail closed as before). A
  duplicate key on `idempotencyKey` returns the existing entry and is success. A crash before the
  insert allocates nothing, so it leaves no gap.
- **Model guards.** New documents must carry `seq`, `prevHash` and `hash` (a direct `AuditLog.create`
  without the service fails validation). `insertMany` is now blocked, because chain entries are written
  one at a time; the Phase 2 test that allowed it changes.
- **Secret.** `AUDIT_CHAIN_SECRET` is required, with the same rules as the other generated secrets
  (P2-L4) and distinct from them. Losing it makes the chain unverifiable, not the log unreadable.
- **Verification.** `audit:verify` (CLI) streams by `seq` and reports the first gap, link mismatch or
  hash mismatch, with a non-zero exit code. It writes an `audit.integrity_checked` entry with the tip
  `seq` and `hash` and logs them, so later runs and forwarded logs can detect truncation of the tail.
- **Legacy.** Entries written before Phase 4 have no `seq`; they are counted and reported as unchained
  (development data only; no production data exists yet).

## Consequences
- Positive: edits, deletions and reordering inside the chain are detectable by anyone holding the key;
  escalation evidence becomes defensible; idempotent writes support the audit outbox (ADR 0011).
- Negative: audit writes are serialised (one tip read plus one insert, a few milliseconds), so a burst of
  audited events (for example failed logins under attack) queues; several API instances would contend
  and retry. Deleting the newest entries is detectable only against an earlier anchor (verify output,
  forwarded logs) until Phase 10 adds external anchoring. A compromised key allows forging, so key
  rotation (a `keyId` per entry) is a Phase 10 follow-up.

## Implementation notes (Phase 4)
- `audit.integrity_checked` carries the tip hash as `tipDigest`: the audit sanitiser drops any metadata key containing `hash`, `pass`, `token` or `secret`.
- `createdAt` is a plain required field set by the service (Mongoose `timestamps` is off for this model), so the stored value is exactly the hashed value.
- Sequence collisions between writers are retried up to 10 times with a short random back-off.
- `AUDIT_CHAIN_SECRET` is removed from `process.env` by the API after start-up (`scrubServerSecrets`, together with the two JWT secrets).

## Amendments (security review, Phase 4)
- **Only numeric `seq` counts (P4-L1, P4-L2).** The tip read, the verifier, the admin audit-log list and every security-relevant read (risk facts, cooldown escalations) filter on `seq` being a number. A planted row with another type can neither become the tip nor stop later writes. `audit:verify` reports it as a break (`non_numeric_seq`).
- **Unchained rows (P4-L1).** `audit:verify` fails (`unchained_after_chain`) for any row without a `seq` dated at or after the first chained row. Only older such rows are reported separately as `unchainedLegacy`. Rows are never trusted as evidence by risk or governance without a `seq`. (A forger can still backdate a row to look like legacy, but such a row is ignored everywhere.)
- **Canonical metadata (P4-L3, P4-L6).** ObjectIds and Dates are passed through the sanitiser and stored as hex and ISO strings; any other non-plain object is refused. Strings and keys that are not well-formed Unicode are refused before a `seq` is taken. Request-derived text (ip, user agent, request id) is normalised (lone surrogate to U+FFFD) instead of refused, so a login can never fail on it.
- **Write timeout.** A write holds the mutex for at most 10 s (`writeTimeoutMs`); on timeout that write fails (login fails closed as before) and the queue is released.
- **`at`.** Trusted server code (reconcile) may date a rebuilt entry; the value is hashed like any other field.

## Amendments (security re-review, Phase 4)
- **Idempotency keys (P4-L9).** The lookup of an earlier write by key only accepts chained rows (numeric `seq`). If an unchained row holds the key, the write is refused with an integrity error (logged). `audit:verify` fails on any row without a `seq` that carries an `idempotencyKey`, whatever its date (`unchained_idempotency_key`). Reconcile existence checks also require a numeric `seq`.
- **Abandoned writes (P4-L10).** The mutex passes an abort signal to the write. The model refuses to insert once the signal is aborted (an `AsyncLocalStorage` context checked on validation), and the service checks it before every insert and retry, so a write reported as failed cannot land later. Every record has an idempotency key (generated as `auto:<uuid>` when the caller gives none). After a timeout the service waits briefly for the abandoned write, then looks the key up: if the entry landed it reports success with its real sequence number, if not (or if the lookup fails) it fails closed. The residual is an insert already on the wire when the signal fires, which the lookup covers.
