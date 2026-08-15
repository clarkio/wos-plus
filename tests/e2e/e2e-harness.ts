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

// The settings dialog's Save flow reconnects to the live WoS mirror game
// (GameSpectator.connectToWosGame in wos-plus-main.ts), which opens a raw
// WebSocket — socket.io configured with `transports: ['websocket']`, no HTTP
// long-polling fallback — directly to this host. `page.route` only
// intercepts HTTP(S) requests, never WebSocket connections, so blocking this
// requires `page.routeWebSocket` as well.
const BLOCKED_WOS_SOCKET_HOST = 'wos2.gartic.es';

export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route(
    (url) => BLOCKED_HOSTS.includes(url.hostname) || url.href === BLOCKED_TWITCH_GQL,
    (route) => route.abort(),
  );

  // Must be registered before navigation (Playwright only intercepts sockets
  // opened after the route is armed). Not calling `ws.connectToServer()`
  // leaves the connection mocked/unopened rather than reaching the real
  // service.
  await page.routeWebSocket(
    (url) => url.hostname === BLOCKED_WOS_SOCKET_HOST,
    () => {},
  );
}

// `/api/words` and `/api/channel-stats/*` (loadWordsFromDb / refreshChannelStats)
// require live Supabase credentials, which this E2E environment does not
// provision — the same gap applies in CI until a maintainer wires up secrets
// for the e2e job. Both routes already catch and log the failure rather than
// throwing, so the page still renders; it's filtered out of the
// console-error assertion below as a known environment limitation, not a
// page defect.
const EXPECTED_500_PATHS = ['/api/words', '/api/channel-stats/'];

// Chrome's own "resource failed to load" console messages are generic and
// carry no URL (`msg.text()` is just one of the two strings below,
// regardless of which request failed), so they can't be attributed to a
// specific request by text alone. `collectUnexpectedConsoleErrors` instead
// tracks the network layer directly (`requestfailed` / `response`) to learn
// *which* URLs are expected to fail, and only forgives that many generic
// console messages — an unrelated failing script, stylesheet, or route still
// surfaces as an unexpected error, since nothing decrements the count for it.
const GENERIC_RESOURCE_FAILURE = /^Failed to load resource: (net::ERR_FAILED|the server responded with a status of 5\d\d)/;

// Produced by our own code (wos-words.ts / streamer channel-stats handling),
// not a generic Chrome message — specific enough on its own, no URL
// correlation needed.
const EXPECTED_APP_LOG_NOISE = /Error (loading WOS dictionary|fetching channel stats)/;

const isKnownExpectedFailureUrl = (url: string): boolean =>
  BLOCKED_HOSTS.some((host) => url.includes(host)) ||
  url === BLOCKED_TWITCH_GQL ||
  EXPECTED_500_PATHS.some((path) => url.includes(path));

/** Starts collecting console errors and uncaught page errors on `page`. Call `blockExternalNetwork` first so aborted-resource noise isn't double counted. */
export function collectUnexpectedConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  let expectedFailures = 0;

  page.on('requestfailed', (request) => {
    if (isKnownExpectedFailureUrl(request.url())) expectedFailures++;
  });

  page.on('response', (response) => {
    if (response.status() >= 400 && isKnownExpectedFailureUrl(response.url())) {
      expectedFailures++;
    }
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();

    if (EXPECTED_APP_LOG_NOISE.test(text)) return;

    if (GENERIC_RESOURCE_FAILURE.test(text) && expectedFailures > 0) {
      expectedFailures--;
      return;
    }

    errors.push(text);
  });

  page.on('pageerror', (err) => {
    errors.push(String(err));
  });

  return errors;
}
