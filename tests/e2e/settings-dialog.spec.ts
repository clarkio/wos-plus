import { test, expect } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';

/**
 * Thin E2E smoke layer (AGENTIC-TESTING-PLAN.md Phase 6 / issue #152).
 *
 * Covers the settings dialog's URL round trip only. Saving also fires real
 * connections to the live WoS mirror socket and Twitch chat (out of scope
 * per the plan — those protocols are already covered deterministically by
 * the fixture-driven worker tests), so this test doesn't assert on console
 * output the way smoke.spec.ts does; it only checks where Save lands the URL.
 */

const MIRROR_URL = 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6';
const TWITCH_CHANNEL = 'somestreamer';

test('player settings dialog round-trips values into URL params', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/player', { waitUntil: 'domcontentloaded' });

  const dialog = page.locator('#player-settings');
  await expect(dialog).toBeVisible();

  await page.fill('#mirror-url-input', MIRROR_URL);
  await page.fill('#twitch-channel-input', TWITCH_CHANNEL);
  // The toggle switch hides its native checkbox off-screen behind the
  // visible `.toggle-slider`; click the slider like a user would rather than
  // the input Playwright can't see.
  await page
    .locator('label:has(#chat-enabled-input) .toggle-slider')
    .click();
  await expect(page.locator('#chat-enabled-input')).not.toBeChecked();

  await page.click('.settings-dialog__save');

  await expect(dialog).not.toBeVisible();

  await expect
    .poll(() => new URL(page.url()).searchParams.get('mirrorUrl'))
    .toBe(MIRROR_URL);

  const params = new URL(page.url()).searchParams;
  expect(params.get('twitchChannel')).toBe(TWITCH_CHANNEL);
  expect(params.get('chat')).toBe('false');
  expect(params.get('board')).toBe('true');
  expect(params.get('clearSound')).toBe('true');
});
