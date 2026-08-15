import { test, expect } from '@playwright/test';
import { blockExternalNetwork, collectUnexpectedFailures } from './e2e-harness';

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

for (const path of ['/', '/player', '/streamer']) {
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

for (const path of ['/player', '/streamer']) {
  test(`${path} opens the settings dialog when required query params are missing`, async ({ page }) => {
    await blockExternalNetwork(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const dialog = page.locator('dialog.settings-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('open', true);
  });
}
