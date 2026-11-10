# ADR 0019: Module media delivery and the "watched" rule

- Status: Proposed 2026-11-10 (Phase 6 plan, docs/architecture/phase-06-plan.md section 5, decisions D6-4, D6-5)
- Date: 2026-11-10
- Deciders: Technical architect, product owner (D6-5), security-tester (review)
- Builds on: ADR 0006 (content completion is client-reported, not a security boundary), ADR 0013 (CSP, `app://csense`, egress filter), ADR 0014 (main is the only network client)
- Amends: the ADR 0013 follow-up "Phase 6 adds the media host to `media-src` and the egress allowlist" (deferred to Phase 10, see below)

## Context
Video modules store `videoUrl` and `captionsUrl` as https URLs (the seed uses `https://media.example.com/csense/placeholder/mN.mp4|vtt`, which do not resolve). The renderer runs under `media-src 'none'` and an egress filter that only allows `app://csense`. There is no CDN until Phase 10 (NFR "CDN media", playbook Phase 10). Phase 6 must play video in the running app and in Windows CI, keep captions (WCAG 1.2.2), and not open the renderer to arbitrary hosts. Content URLs are authored data: in Phase 7 an administrator account (or a compromised one) writes them, so a URL from the API must not become a way to make the workstation fetch an arbitrary host.

The module gate before the quiz is "every exercise answered + the client reports the lesson finished" (D3-7). Nothing server-side can prove a video was watched, and no XP depends on it (ADR 0009).

## Decision
1. **Bundled media pack, served by main.** Phase 6 ships a small media pack in `desktop/resources/media/`: one in-house silent placeholder clip (WebM/VP9, at most 8 s and 500 KB, provenance and the exact `ffmpeg` command recorded in the folder README) and one WebVTT file per seeded video module, plus `manifest.json`.
   - The manifest maps a path *relative to the configured media base URL* to a file and MIME type, for example `"placeholder/m1.mp4" -> { file: "placeholder-lesson.webm", type: "video/webm" }`.
   - The pack is served under the existing origin at `app://csense/media/<file>`. Only files named in the manifest are served (an allowlist, not a directory listing). Path traversal is rejected by the same rules as `resolveAppFile`.
   - The protocol handler supports single-range `Range: bytes=a-b` requests (206 with `Content-Range`, `Accept-Ranges: bytes`, 416 on an unsatisfiable range) so seeking works. The `app` scheme gains the `stream: true` privilege.
2. **Main rewrites content URLs; the renderer never sees them.** `learning.getModule` maps `content.video.url` and `captionsUrl` through a pure `resolveMediaUrl(url, { baseUrl, manifest })`:
   - accepted only if the URL is https, has no credentials, query or fragment, has the origin of `MAIN_VITE_MEDIA_BASE_URL`, its path starts with the base path, and the remainder is a manifest key;
   - the result is `app://csense/media/<file>`, otherwise `null`. A `null` video shows the "Video unavailable" state with the transcript.
3. **CSP.** `media-src 'self'` replaces `media-src 'none'` in both the meta tag and the protocol response header. The development CSP variant adds `app://csense` because the dev renderer runs on the dev-server origin. The egress filter is unchanged.
4. **Remote mode is Phase 10.** `MAIN_VITE_MEDIA_MODE` accepts only `bundled` in Phase 6. Phase 10 adds `remote`: the CDN origin from config goes into `media-src` (build-time) and into the egress filter for `resourceType === 'media'` only; captions need CORS (`crossorigin`), and URL resolution keeps the same base-URL allowlist.
5. **The "watched" rule is a UI rule, not a control.** "Finish lesson" for a video module is enabled when any of these holds:
   - the furthest *contiguous* playback position reaches 90 % of the duration (forward seeks past the furthest watched point do not count; a tolerance of 2 s absorbs `timeupdate` granularity);
   - the employee opened the transcript and its last cue scrolled into view (the text alternative, WCAG 1.2.3);
   - the video cannot be played (`null` source or a load error), in which case the transcript is shown.
   Watch state is not sent to the server and is not persisted. `POST /modules/:id/content/complete` remains the only server record, and it stays client-reported (ADR 0006).

## Consequences
- Positive: video, captions and seeking work offline from the API, in CI and under the strict CSP with no new egress. An authored URL can never point the renderer at an arbitrary host: unknown URLs degrade to "Video unavailable". The remote path is designed and only needs configuration and CSP generation in Phase 10.
- Negative: production content cannot be shown until Phase 10 (the placeholder pack is for development, demos and tests). A binary asset lives in git (kept tiny). Range handling in a custom protocol is code we own and must test. The watched rule can be bypassed by a modified client; this is accepted and documented because nothing of value (XP, pass, unlock) depends on it.
- Follow-ups: Phase 7 content authoring must require `captionsUrl` and transcript cues for video modules (shared authoring refine added in Phase 6); Phase 10 implements remote mode and moves the pack to `extraResources`.
