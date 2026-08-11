import type { Page } from '@playwright/test';

/**
 * Shared setup for the thin E2E smoke layer (AGENTIC-TESTING-PLAN.md Phase 6
 * / issue #152). Keeps the suite hermetic and independent of the sandbox's
 * network policy, matching the "zero real network" convention the acceptance
 * stream already established (tests/acceptance/network-mock.ts) — a CI run
 * should not depend on whether fonts.googleapis.com or gql.twitch.tv happen
 * to be reachable.
 */

// The base page loads Google Fonts as a render-blocking stylesheet. Aborting
// it keeps navigation fast and deterministic; it has no bearing on whether
// WoS+ itself works.
const BLOCKED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Twitch's own unofficial GQL lookup (src/scripts/twitch-channel.ts),
// exercised by the settings dialog's Save flow. `twitchChannelExists`
// treats a failed/aborted request as "unknown" rather than "invalid", so
// aborting it here doesn't block saving — it just keeps the channel-exists
// round trip out of this suite's scope (real Twitch accounts are external
// state, not something a smoke test should depend on).
const BLOCKED_TWITCH_GQL = 'https://gql.twitch.tv/gql';

export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route(
    (url) => BLOCKED_HOSTS.includes(url.hostname) || url.href === BLOCKED_TWITCH_GQL,
    (route) => route.abort(),
  );
}

// `/api/words` (loadWordsFromDb in wos-words.ts) requires live Supabase
// credentials, which this E2E environment does not provision — the same gap
// applies in CI until a maintainer wires up secrets for the e2e job. The
// route already catches and logs the failure rather than throwing, so it
// doesn't break the page; it's filtered out of the console-error assertion
// below as a known environment limitation, not a page defect.
//
// Chrome's own "resource failed to load" console messages are generic and
// carry no URL (`msg.text()` is just the string below, regardless of which
// request failed), so the only way to attribute one is by message shape —
// both of these are the *expected* shapes for requests this suite itself
// intercepts/aborts (blocked hosts) or that require credentials this
// environment doesn't have (`/api/words`). Anything else failing to load is
// a real regression.
const EXPECTED_CONSOLE_NOISE = [
  /Error loading WOS dictionary/,
  /^Failed to load resource: net::ERR_FAILED$/,
  /^Failed to load resource: the server responded with a status of 500/,
];

/** Starts collecting console errors and uncaught page errors on `page`. Call `blockExternalNetwork` first so aborted-resource noise isn't double counted. */
export function collectUnexpectedConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (EXPECTED_CONSOLE_NOISE.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });

  page.on('pageerror', (err) => {
    errors.push(String(err));
  });

  return errors;
}
