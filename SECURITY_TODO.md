# Security Todo

This document tracks security work identified during the May 2026 project review.
Use the checkboxes to track remediation progress and keep notes inline as work is
completed.

Status legend: `[ ]` not started, `[-]` in progress, `[x]` complete.

## 1. Critical: Lock Down Public Database Writes

Status: [ ]
Priority: Critical

Affected files:
- `src/pages/api/boards/index.ts`
- `src/scripts/db-service.ts`
- Supabase API key and RLS configuration

Risk:
`POST /api/boards` accepts unauthenticated public requests, parses arbitrary JSON,
and inserts the full request body into Supabase while using `SUPABASE_KEY`. The
current local key format is `sb_secret_...`, which is an elevated backend key and
can bypass Row Level Security.

Tasks:
- [ ] Decide who is allowed to create boards and document that trust model.
- [ ] Replace raw body insertion with a strict board schema validator.
- [ ] Reject unknown fields before calling Supabase.
- [ ] Enforce board ID format server-side.
- [ ] Enforce slot count, slot shape, word length, letter format, and maximum payload size.
- [ ] Require authentication, a signed server-side write token, or another anti-abuse control for writes.
- [ ] Add rate limiting or bot protection for `POST /api/boards`.
- [ ] Stop using a Supabase secret/service key for unauthenticated public write paths.
- [ ] Confirm Supabase RLS policies protect the `boards` table if using anon/publishable keys.
- [ ] Add tests for valid create, invalid schema, oversized payload, unauthenticated request, duplicate board, and unknown fields.

Verification:
- [ ] `POST /api/boards` rejects unauthenticated or unsigned external requests.
- [ ] Invalid or extra request fields are rejected.
- [ ] Supabase writes cannot bypass intended table policy from a public route.
- [ ] Tests cover success and failure cases.

## 2. High: Reduce Public Database Read Exposure

Status: [ ]
Priority: High

Affected files:
- `src/pages/api/boards/index.ts`
- `src/pages/api/boards/[id].ts`
- `src/pages/api/words.ts`
- `src/pages/api/channel-stats/[channel].ts`
- Supabase RLS configuration

Risk:
Public API routes use the elevated Supabase key and return broad database results.
`GET /api/boards` and `GET /api/boards/[id]` select `*`, while `/api/words`
returns the complete dictionary.

Tasks:
- [ ] Replace public route database access with a publishable/anon key where possible.
- [ ] Confirm RLS is enabled for publicly readable tables.
- [ ] Add explicit allowlist policies for public reads.
- [ ] Replace `.select('*')` with explicit column lists.
- [ ] Remove any fields that are not required by the client.
- [ ] Add pagination or limits to list endpoints, especially `/api/boards` and `/api/words`.
- [ ] Add caching for large low-change responses such as `/api/words`.
- [ ] Add rate limiting for public read endpoints.
- [ ] Add tests that verify sensitive columns are not returned.

Verification:
- [ ] Public routes return only expected fields.
- [ ] Large endpoints are paginated, cached, or otherwise bounded.
- [ ] RLS blocks direct public access outside intended policies.

## 3. Medium: Stop Returning Raw Backend Error Messages

Status: [ ]
Priority: Medium

Affected files:
- `src/pages/api/boards/index.ts`
- `src/pages/api/boards/[id].ts`
- `src/pages/api/channel-stats/[channel].ts`
- `src/pages/api/words.ts`

Risk:
Several routes return `error.message` directly to clients. Database and SDK
errors can reveal schema names, constraint names, query details, or operational
state.

Tasks:
- [ ] Replace client-facing `error.message` responses with generic messages.
- [ ] Add stable application error codes for known failures.
- [ ] Keep detailed errors in server logs only.
- [ ] Make duplicate board handling return the existing safe `BOARD_EXISTS` code.
- [ ] Add tests to confirm internal error details are not exposed.

Verification:
- [ ] Simulated Supabase errors return generic JSON to clients.
- [ ] Server logs still preserve enough information for debugging.

## 4. Medium: Restrict User-Controlled iframe and Socket Inputs

Status: [ ]
Priority: Medium

Affected files:
- `src/pages/player.astro`
- `src/pages/streamer.astro`
- `src/scripts/wos-plus-main.ts`

Risk:
`mirrorUrl` accepts any `http://` or `https://` URL and assigns it to an iframe.
Crafted links can make the app render arbitrary third-party content inside the
interface. Twitch channel values from query params are also used without the same
validation path used by the settings dialog.

Tasks:
- [ ] Only allow `https://wos.gg/r/<expected-code>` mirror URLs.
- [ ] Reject `http://` mirror URLs.
- [ ] Normalize and validate mirror code format before assigning iframe `src`.
- [ ] Add `sandbox` and `referrerpolicy` attributes to the WoS iframe.
- [ ] Apply Twitch channel validation consistently for settings input and URL query params.
- [ ] Reject Twitch channel values outside Twitch username rules.
- [ ] Add tests for allowed and rejected mirror URLs.
- [ ] Add tests for Twitch channel normalization and rejection.

Verification:
- [ ] `mirrorUrl=https://example.com` is rejected and not assigned to the iframe.
- [ ] Valid WoS mirror URLs continue to work.
- [ ] Invalid Twitch channel query params do not update iframe or client connection state.

## 5. Medium: Update Vulnerable Dependencies

Status: [ ]
Priority: Medium

Affected files:
- `package.json`
- `pnpm-lock.yaml`

Audit command:
`pnpm.cmd audit --prod`

Current audit findings:
- [ ] High: `undici` malicious WebSocket 64-bit length parser crash, patched in `>=7.24.0`.
- [ ] High: `undici` unbounded WebSocket permessage-deflate memory consumption, patched in `>=7.24.0`.
- [ ] High: `undici` unhandled exception from invalid `server_max_window_bits`, patched in `>=7.24.0`.
- [ ] Moderate: `parseuri` ReDoS through `socket.io-client@2.5.0`, patched in `parseuri>=2.0.0`.
- [ ] Moderate: `undici` unbounded decompression chain, patched in `>=7.18.2`.
- [ ] Moderate: `undici` HTTP request/response smuggling, patched in `>=7.24.0`.
- [ ] Moderate: `undici` CRLF injection via upgrade option, patched in `>=7.24.0`.
- [ ] Moderate: `astro@5.18.1` `define:vars` XSS advisory, patched in `astro>=6.1.6`.
- [ ] Low: `@astrojs/cloudflare@12.6.13` image transform SSRF advisory, patched in `>=13.1.10`.

Tasks:
- [ ] Upgrade Astro and `@astrojs/cloudflare` together and review migration notes.
- [ ] Upgrade Wrangler/Miniflare path so `undici` resolves to a patched version.
- [ ] Evaluate whether `socket.io-client` can be upgraded without breaking the WoS socket protocol.
- [ ] If `socket.io-client` cannot be upgraded immediately, document the risk and add compensating validation around socket URLs.
- [ ] Run `pnpm install` and commit lockfile changes.
- [ ] Run `pnpm.cmd audit --prod` until the known findings are resolved or documented.
- [ ] Run the full test suite and production build after upgrades.

Verification:
- [ ] `pnpm.cmd audit --prod` has no unresolved high or medium findings, or each exception has a written justification.
- [ ] `pnpm run build` succeeds.
- [ ] `pnpm test` succeeds.
- [ ] Manual smoke test confirms player and streamer views still connect to WoS and Twitch.

## 6. Medium-Low: Prevent Public Source Map Exposure

Status: [ ]
Priority: Medium-Low

Affected files:
- `astro.config.mjs`
- `wrangler.jsonc`
- `.github/workflows/astro.yml`
- Build/deploy scripts
- `dist/**/*.map`

Risk:
The current build output contains `.map` files with `sourcesContent`. If `dist`
is deployed as-is, source code and comments are publicly retrievable. The Sentry
integration is configured to delete maps after upload, but local `dist` still
contains maps and the GitHub Pages workflow uploads `dist`.

Tasks:
- [ ] Decide whether production source maps should exist publicly.
- [ ] Make source map deletion a required build/deploy step.
- [ ] Ensure Sentry source map upload completes before deletion when enabled.
- [ ] Add a CI check that fails if `dist/**/*.map` exists in deploy artifacts.
- [ ] Confirm `dist` remains untracked by git.
- [ ] Document how to generate private source maps for debugging.

Verification:
- [ ] Production artifact contains no `.map` files unless explicitly intended.
- [ ] Source maps, if generated, are uploaded only to Sentry or another private store.
- [ ] CI blocks accidental public source map deployment.

## 7. Hardening: Add Security Headers

Status: [ ]
Priority: Medium-Low

Affected files:
- Cloudflare Pages/Workers headers configuration
- `wrangler.jsonc`
- Astro middleware or response wrapper if needed

Risk:
No Content Security Policy, frame policy, referrer policy, permissions policy,
or HSTS config was found. These headers reduce the impact of XSS, clickjacking,
referrer leakage, and unwanted browser capabilities.

Tasks:
- [ ] Add a Content Security Policy compatible with Astro, Sentry, Twitch, WoS, Google Fonts, and app assets.
- [ ] Add `frame-ancestors` policy appropriate for OBS/stream usage.
- [ ] Add `Referrer-Policy`.
- [ ] Add `Permissions-Policy`.
- [ ] Add `Strict-Transport-Security` for production HTTPS.
- [ ] Add `X-Content-Type-Options: nosniff`.
- [ ] Test player, streamer, bot, and index pages under the new headers.

Verification:
- [ ] Browser devtools show the expected security headers.
- [ ] No required third-party integrations are blocked unexpectedly.
- [ ] Security header scan shows no missing high-value headers.

## 8. Hardening: Review Sentry PII and Replay Collection

Status: [ ]
Priority: Medium-Low

Affected files:
- `sentry.client.config.js`
- `sentry.server.config.js`

Risk:
Both Sentry configs set `sendDefaultPii: true`, and the client enables Replay.
The app handles Twitch channel names, chat-derived words, URLs, request headers,
and user interaction data, so telemetry should be intentionally scoped.

Tasks:
- [ ] Decide whether default PII collection is required.
- [ ] Disable `sendDefaultPii` unless there is a documented need.
- [ ] Configure Sentry `beforeSend` and/or scrubbing rules for request headers, URLs, Twitch channel names, and chat-derived content.
- [ ] Review Replay masking and blocking settings.
- [ ] Lower replay sampling if production privacy risk outweighs debugging value.
- [ ] Document telemetry behavior in a privacy note or README section.

Verification:
- [ ] Sentry events do not include unexpected PII.
- [ ] Replay masks sensitive inputs and displayed user-derived values as intended.
- [ ] Privacy/telemetry behavior is documented.

## 9. Hardening: Reduce Sensitive Client Logging

Status: [ ]
Priority: Low

Affected files:
- `src/scripts/wos-plus-main.ts`
- `src/scripts/db-service.ts`
- `src/scripts/wos-words.ts`
- `src/pages/player.astro`
- `src/pages/streamer.astro`

Risk:
The client logs Twitch messages, board slots, mirror URLs, discovered words,
letters, and game state. This is mostly local browser exposure, but it can
increase privacy risk and make shared browser logs or support screenshots leak
channel/game details.

Tasks:
- [ ] Gate debug logs behind a development flag.
- [ ] Remove or redact Twitch message and board slot logs in production.
- [ ] Avoid logging full mirror URLs in production.
- [ ] Add a small logger helper that no-ops debug logs in production.

Verification:
- [ ] Production build does not emit routine game/chat debug logs.
- [ ] Development logs remain available when explicitly enabled.

## References

- Supabase API keys: https://supabase.com/docs/guides/api/api-keys
- `undici` advisories:
  - https://github.com/advisories/GHSA-f269-vfmq-vjvj
  - https://github.com/advisories/GHSA-vrm6-8vpv-qv8q
  - https://github.com/advisories/GHSA-v9p9-hfj2-hcw8
  - https://github.com/advisories/GHSA-g9mf-h72j-4rw9
  - https://github.com/advisories/GHSA-2mjp-6q6p-2qxm
  - https://github.com/advisories/GHSA-4992-7rv2-5pvq
- `parseuri` advisory: https://github.com/advisories/GHSA-6fx8-h7jm-663j
- Astro advisory: https://github.com/advisories/GHSA-j687-52p2-xcff
- `@astrojs/cloudflare` advisory: https://github.com/advisories/GHSA-88gm-j2wx-58h6
