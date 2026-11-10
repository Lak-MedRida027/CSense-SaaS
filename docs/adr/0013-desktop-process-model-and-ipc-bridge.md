# ADR 0013: Desktop process model, preload bridge and IPC contract

- Status: Accepted 2026-11-10 (Phase 5 plan, docs/architecture/phase-05-plan.md section 4, decisions D5-14, D5-20)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (approval), security-tester (review)
- Builds on: ADR 0001 (Electron, enforcement in main), ADR 0004 (main holds the refresh token), ADR 0005 (route registry pattern)

## Context
Phase 5 turns the empty Electron shell into the enforcement tool: the start-up gate, the quiz lockdown, secure tokens and notifications. The renderer runs React and is the XSS target. The main process is privileged. Today the preload exposes only `appVersion`. The renderer CSP allows `connect-src http://localhost:4000`. The UI loads from `file://`.

## Decision
1. **Three trust zones.** The renderer is untrusted. The preload is a thin typed adapter. Main is the only place that holds tokens, talks to the network, changes window state or touches the clipboard.
2. **Bridge v1** (`window.csense`, frozen, `bridgeVersion: 1`).
   - Named methods grouped by area: `session`, `gate`, `assessment`, `learning`, `events.subscribe`.
   - One invoke channel per method (`csense:v1:<area>.<method>`) and one push channel.
   - **No generic passthrough:** no exposed `invoke`, no "call any API path", and no `IpcRendererEvent` objects passed to the renderer.
3. **Main-side IPC registry** (mirrors ADR 0005).
   - Every channel declares a strict zod input schema.
   - `assertIpcRegistry()` refuses to start on a missing schema, a duplicate, or a mismatch with the preload channel list. Both lists come from one shared constant.
   - Every invoke checks that the sender is the main window's top-level frame on the app origin.
   - Payloads are capped at 64 KB, and each channel is rate-guarded.
   - Results are values (`{ok, data} | {ok:false, error:{code,message}}`); exceptions never cross IPC.
   - The channel inventory is snapshot-tested.
4. **Responses** returned to the renderer are parsed with the shared strict response schemas, so extra or unexpected fields (a token, a key) never reach the UI.
5. **Origin and loading.**
   - The renderer is served from a privileged custom scheme `app://csense` via `protocol.handle`, with path-traversal guards and a CSP response header. `file://` is no longer used.
   - Navigation, redirects, new windows, webviews, drag-and-drop navigation and every permission request are denied.
   - `shell.openExternal` is limited to an https allowlist (empty by default).
6. **Network isolation.**
   - The renderer CSP is `connect-src 'self'`.
   - A `webRequest` filter on the UI session cancels any request outside the app origin (and the dev server when unpackaged).
   - The API is reached only by main through a separate in-memory session (`session.fromPartition('csense-api')`, `ses.fetch`). It uses Chromium's network stack, the system proxy and the OS trust store. TLS errors are never overridden.
7. **API URL policy.**
   - Packaged builds accept only an `https:` base URL from the build-time config.
   - Unpackaged builds also accept `http:` to `localhost`, `127.0.0.1` or `::1`, plus runtime overrides (`CSENSE_*`) used by e2e.
   - Credentials, queries and fragments in the URL are refused.
   - A refused config shows a "misconfigured" screen and makes no request.
8. **Development relaxations are keyed on `app.isPackaged === false`**, never on an environment variable alone. Packaged builds abort on debugging switches (`--inspect`, `--remote-debugging-port`, ...).
   - Electron fuses (`RunAsNode` off, `NODE_OPTIONS` off, inspect arguments off, ASAR integrity and only-from-ASAR on, cookie encryption on) are defined now and applied by the Phase 10 packaging step. Playwright needs the inspector on unpackaged builds.
9. **Testability.** Main code imports Electron only through `main/electron/ports.ts`, so controllers are unit-tested with fakes in a node Vitest project.

## Consequences
- Positive:
  - The renderer can neither read a credential nor open a connection.
  - Every privileged capability is enumerable and reviewable (the channel snapshot), and has validated input.
  - The production and development differences are explicit and tested.
- Negative:
  - Every new API need (Phase 6 and 7) requires a bridge method, an operation entry and a schema. That is more boilerplate, by design.
  - The custom protocol and the dev-only CSP transform add build complexity.
  - `style-src 'unsafe-inline'` remains until Phase 9 evaluates hashes or nonces.
- Follow-ups: Phase 6 adds the media host to `media-src` and to the egress allowlist; Phase 10 applies the fuses and signs the binaries.
