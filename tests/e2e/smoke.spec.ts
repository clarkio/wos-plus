import { test, expect } from '@playwright/test';
import { blockExternalNetwork, collectUnexpectedConsoleErrors } from './e2e-harness';

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
    const errors = collectUnexpectedConsoleErrors(page);

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    // Give deferred scripts (dialog init, worker startup) a moment to settle
    // before asserting the console stayed clean.
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
  });
}

for (const path of ['/player', '/streamer']) {
  test(`${path} opens the settings dialog when required query params are missing`, async ({ page }) => {
    await blockExternalNetwork(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const dialog = page.locator('dialog.settings-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('open', true);
  });
}
