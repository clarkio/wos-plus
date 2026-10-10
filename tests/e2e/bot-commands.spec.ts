import { test, expect } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';
import { allBotCommands } from '../../src/data/bot-commands';

/**
 * `/bot/commands` is where the bot's `!help` reply sends chat
 * (https://wosplus.com/bot/commands), so it must actually render every
 * command in the reference data — a unit test of that data cannot tell
 * whether the page still loops over all of it.
 */

test('/bot/commands renders every bot command', async ({ page }) => {
  await blockExternalNetwork(page);
  const response = await page.goto('/bot/commands', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  const commands = allBotCommands();
  await expect(page.locator('[data-bot-command]')).toHaveCount(commands.length);
  for (const c of commands) {
    await expect(page.locator(`[data-bot-command="${c.name}"]`)).toContainText(c.usage);
  }
});

for (const path of ['/bot', '/bot/setup']) {
  test(`${path} links to the commands page`, async ({ page }) => {
    await blockExternalNetwork(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('a[href="/bot/commands"]').first()).toBeVisible();
  });
}
