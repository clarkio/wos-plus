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
// throwing, so the page still renders; it's a known environment limitation,
// not a page defect.
const EXPECTED_500_PATHS = ['/api/words', '/api/channel-stats/'];

const isKnownExpectedFailureUrl = (url: string): boolean =>
  BLOCKED_HOSTS.some((host) => url.includes(host)) ||
  url === BLOCKED_TWITCH_GQL ||
  EXPECTED_500_PATHS.some((path) => url.includes(path));

// Chrome's own "resource failed to load" console messages are generic and
// carry no URL (`msg.text()` is just one of the two strings below, regardless
// of which request failed) — Playwright's `console` and `requestfailed`/
// `response` events also aren't guaranteed to arrive in a correlated order,
// so a per-page counter of "how many failures are expected right now" can't
// be attributed to a specific message without risking exactly the failure
// mode this suite exists to catch: an unrelated failure consuming budget left
// over from an earlier *expected* one and going unreported. Rather than
// guess, `collectUnexpectedFailures` drops these generic messages from the
// console-error list entirely and answers "did anything unexpected fail?"
// from the network layer instead, where every event carries its own URL and
// there is nothing left to correlate.
const GENERIC_RESOURCE_FAILURE = /^Failed to load resource: (net::ERR_FAILED|the server responded with a status of 5\d\d)/;

// Produced by our own code (wos-words.ts / streamer channel-stats handling),
// not a generic Chrome message — specific enough on its own, no URL
// correlation needed.
const EXPECTED_APP_LOG_NOISE = /Error (loading WOS dictionary|fetching channel stats)/;

export interface UnexpectedFailures {
  /** Console `error` messages and uncaught page errors, excluding the unattributable generic resource-load noise (see `GENERIC_RESOURCE_FAILURE`) and known app-log noise. */
  consoleErrors: string[];
  /** URLs of failed requests / 4xx+5xx responses that aren't one of the known expected failures (`isKnownExpectedFailureUrl`) — the precise, URL-attributed check `consoleErrors` can't provide on its own. */
  unexpectedRequestFailures: string[];
}

/** Starts collecting console/page errors and unexpected network failures on `page`. Call `blockExternalNetwork` first so aborted-resource noise isn't double counted. */
export function collectUnexpectedFailures(page: Page): UnexpectedFailures {
  const result: UnexpectedFailures = { consoleErrors: [], unexpectedRequestFailures: [] };

  const noteIfUnexpected = (url: string) => {
    if (!isKnownExpectedFailureUrl(url)) result.unexpectedRequestFailures.push(url);
  };

  page.on('requestfailed', (request) => { noteIfUnexpected(request.url()); });
  page.on('response', (response) => {
    if (response.status() >= 400) noteIfUnexpected(response.url());
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (EXPECTED_APP_LOG_NOISE.test(text)) return;
    if (GENERIC_RESOURCE_FAILURE.test(text)) return;
    result.consoleErrors.push(text);
  });

  page.on('pageerror', (err) => {
    result.consoleErrors.push(String(err));
  });

  return result;
}
