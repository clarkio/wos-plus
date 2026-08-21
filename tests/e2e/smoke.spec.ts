import { test, expect } from '@playwright/test';
import { blockExternalNetwork, collectUnexpectedFailures } from './e2e-harness';

const MIRROR_URL = 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6';

/**
 * Thin E2E smoke layer (AGENTIC-TESTING-PLAN.md Phase 6 / issue #152).
 *
 * Runs against a production build through the real Cloudflare Workers
 * runtime (`wrangler dev`, see playwright.config.ts's `webServer`) — the one
 * layer that catches `prerender = false` / `locals.runtime.env`
 * misconfigurations that unit and acceptance tests structurally cannot see,
 * because they never invoke a route through an actual Workers runtime.
 */

test('GET /api/health returns 200 through the real Workers runtime', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: 'ok' });
});

for (const path of ['/', '/player', '/streamer', '/bot', '/bot/setup']) {
  test(`${path} loads without unexpected console errors`, async ({ page }) => {
    await blockExternalNetwork(page);
    const { consoleErrors, unexpectedRequestFailures } = collectUnexpectedFailures(page);

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    // Give deferred scripts (dialog init, worker startup) a moment to settle
    // before asserting the console stayed clean.
    await page.waitForTimeout(500);

    expect(consoleErrors).toEqual([]);
    expect(unexpectedRequestFailures).toEqual([]);
  });
}

test('an unrelated request failure still surfaces after a known expected one', async ({ page }) => {
  // Regression for a review finding: an earlier version tracked "how many
  // failures are currently expected" as a single page-global counter, which
  // console/network events could decrement out of order — letting a later,
  // genuinely unrelated failure silently consume budget left over from an
  // earlier expected one (e.g. /api/words' known 500, see EXPECTED_500_PATHS
  // in e2e-harness.ts) and go unreported. collectUnexpectedFailures now
  // judges each request by its own URL instead, so this must always surface.
  await blockExternalNetwork(page);
  await page.route('**/definitely-not-a-real-route', (route) => route.abort());
  const { unexpectedRequestFailures } = collectUnexpectedFailures(page);

  // /player's page load already triggers the known-expected /api/words
  // failure (no Supabase credentials in this environment) before the
  // unrelated request below ever fires.
  await page.goto('/player', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => fetch('/definitely-not-a-real-route').catch(() => {}));
  await page.waitForTimeout(300);

  expect(unexpectedRequestFailures).toEqual(
    expect.arrayContaining([expect.stringContaining('/definitely-not-a-real-route')]),
  );
});

test('the board iframe never reaches the real wos.gg host', async ({ page }) => {
  // Regression for #203. The board iframe's src is set straight to the mirror
  // URL, so a test supplying a valid `mirrorUrl` makes the browser fetch
  // https://wos.gg/r/<id> for real. Nothing failed because no test asserted on
  // it, which left the suite quietly dependent on that host being reachable —
  // the opposite of the "zero real network" convention in CLAUDE.md §7/§9.
  //
  // Asserted via `requestfinished` rather than the console or the failure
  // recorder: an aborted request fires `requestfailed`, never
  // `requestfinished`, so this asks precisely "did anything complete against
  // wos.gg".
  //
  // Note what this test can and cannot do. Where wos.gg is reachable — CI, a
  // developer's machine — it genuinely catches the regression, because
  // without the harness block the iframe load completes. In a fully offline
  // sandbox it passes vacuously: nothing completes against any external host
  // whether the harness blocks it or not. That is why the *policy* is pinned
  // separately and deterministically in tests/unit/e2e-harness.test.ts; this
  // test is the end-to-end confirmation that the policy is actually wired
  // into the page's real network activity.
  await blockExternalNetwork(page);

  const completedWosGgRequests: string[] = [];
  page.on('requestfinished', (request) => {
    if (new URL(request.url()).hostname === 'wos.gg') {
      completedWosGgRequests.push(request.url());
    }
  });

  const params = new URLSearchParams({
    mirrorUrl: MIRROR_URL,
    twitchChannel: 'somestreamer',
  });
  await page.goto(`/player?${params.toString()}`, { waitUntil: 'domcontentloaded' });

  // The iframe really was pointed at the mirror — without this the test would
  // pass just as well on a page that never tried to load a board at all.
  await expect(page.locator('#player-wos-board-iframe')).toHaveAttribute(
    'src',
    MIRROR_URL,
  );
  await page.waitForTimeout(500);

  expect(completedWosGgRequests).toEqual([]);
});

for (const path of ['/player', '/streamer']) {
  test(`${path} opens the settings dialog when required query params are missing`, async ({ page }) => {
    await blockExternalNetwork(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const dialog = page.locator('dialog.settings-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('open', true);
  });
}
