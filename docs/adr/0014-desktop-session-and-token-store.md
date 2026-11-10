# ADR 0014: Desktop session, token store and the main-process API client

- Status: Accepted 2026-11-10 (Phase 5 plan section 5, decisions D5-13, D5-14)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Closes: ADR 0004 follow-up "whether the main process also holds the access token and proxies every API call"

## Context
ADR 0004 returns the refresh token in the JSON body and requires that only the Electron main process holds it, persisted with `safeStorage`. It also requires single-flight refresh, because concurrent refreshes look like reuse and revoke the family. ADR 0007 sessions last 60 minutes, much longer than the 15-minute access token, so a quiz must survive a refresh. CLAUDE.md asks for an "httpOnly store" for the refresh token.

## Decision
1. **Both tokens live only in main.**
   - The access token is held in memory only, never persisted, logged or sent over IPC.
   - The refresh token is held in memory and persisted as `safeStorage.encryptString` output (DPAPI on Windows) in `userData/session.v1.json`, written atomically.
2. **Refuse rather than store plaintext.** If `safeStorage.isEncryptionAvailable()` is false, or the Linux backend is `basic_text`, the session is memory-only and the user signs in at each launch. There is no override.
   - A corrupt, undecryptable or expired file is deleted.
3. **Main-process API client.**
   - A closed operations table (method, path builder with validated ObjectIds, input and response schemas, auth mode) is called by the IPC handlers. The renderer never calls the API.
   - Bearer attached from memory; time-outs and size caps.
   - **Single-flight refresh:** one in-flight promise. A refresh is triggered when the access token has under 60 s left, or after a 401 `UNAUTHENTICATED` (then one retry; a 401 means the request was not processed).
   - A proactive refresh timer runs while quiz lockdown is active.
   - The rotated refresh token is persisted before the refresh resolves.
4. **Session end.**
   - `INVALID_REFRESH_TOKEN`, or a 401 after a refresh, wipes memory and file and re-locks the gate (deferred until any lockdown exits).
   - Logout sends `POST /auth/logout` best effort, then wipes regardless of the result.
5. **Why a proxy instead of giving the renderer the access token:**
   - Renderer XSS cannot exfiltrate a bearer token.
   - Refresh and rotation exist in one place, which ADR 0004 D-4 requires.
   - Main must observe session starts (lockdown validation, ADR 0016) and gate grants (release, ADR 0015) anyway.
   - Renderer network access can be denied completely.
6. **Persistence across restarts is on by default.** A start-up with a valid encrypted session resumes silently. The absolute 7-day session lifetime still forces a credential entry weekly.

## Consequences
- Positive:
  - It meets the "httpOnly store" intent: the token is unreachable from page JavaScript, as ADR 0004 argues.
  - No refresh races.
  - Mid-quiz expiry is invisible to the user.
  - Revocation and deactivation take effect on the next call.
- Negative:
  - If the app crashes between a server rotation and the local write, the next launch presents a spent token. Reuse detection then revokes the family and the user signs in again. This is accepted as the secure outcome.
  - An IPC hop per call.
  - On Linux without a keyring, users sign in every launch.
  - Anyone with the OS user's session can use the persisted session, because DPAPI binds the token to the OS user, not to a person. This matches the OS trust boundary.
