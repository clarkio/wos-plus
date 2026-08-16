import { test, expect } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';

/**
 * Post-authorization chatbot setup instructions (issue #178).
 *
 * `/bot/setup` is the page the bot service redirects to after a streamer
 * authorizes WoS+ Bot, so the instructions a streamer needs at that moment
 * must actually be on it. These assertions pin the four things the issue
 * names — verify with `!ping`, mod the bot (rate limits + link-posting
 * moderation), copy the WoS mirror link, then `!mirror set <link>` — rather
 * than the page's wording around them.
 */

test('/bot/setup lists the post-authorization steps', async ({ page }) => {
  await blockExternalNetwork(page);
  const response = await page.goto('/bot/setup', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  const steps = page.locator('[data-setup-steps]');
  // The hero counts the steps in prose ("Four short steps"), which silently
  // goes stale if a step is added or merged. Pin the rendered count so the
  // two can't drift apart unnoticed.
  await expect(steps.locator('li.sp-setup-item')).toHaveCount(4);
  await expect(steps).toContainText('!ping');
  await expect(steps).toContainText('/mod WoSPlusBot');
  await expect(steps).toContainText('!mirror set');
});

test('/bot links to the setup instructions', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.goto('/bot', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('a[href="/bot/setup"]').first()).toBeVisible();
});
