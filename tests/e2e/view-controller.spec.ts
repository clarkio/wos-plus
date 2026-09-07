import { test, expect, type Page } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';

/**
 * What remains at the E2E layer after #128 step 3 folded the view-controller
 * characterization tests into the unit stream
 * (`tests/unit/view-controller.test.ts`, per CLAUDE.md §9).
 *
 * These two are the part a unit test structurally cannot make: that each
 * `.astro` page really *renders* the elements the shared controller looks up.
 * The controller is now one module driven by a view name, so a page that
 * stopped emitting a control — or emitted it under the wrong prefix — would
 * still satisfy every unit test, which builds its own fixture DOM. Only
 * loading the real page catches that.
 */

async function armView(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  // Not suite-wide policy: smoke.spec.ts deliberately lets the embed load
  // while checking pages for console errors.
  await page.route('https://www.twitch.tv/embed/**', (route) => route.abort());
}

for (const view of ['player', 'streamer'] as const) {
  test(`/${view} renders every control the shared view controller drives`, async ({ page }) => {
    await armView(page);
    await page.goto(`/${view}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator(`#${view}-settings`)).toBeVisible();

    // Every element `createViewController('${view}')` looks up by a
    // view-derived id, so the page and the module cannot drift apart silently.
    for (const id of [
      `${view}-mirror-url-input`,
      `${view}-mirror-url-error`,
      `${view}-twitch-channel-input`,
      `${view}-twitch-channel-error`,
      `${view}-chat-enabled-input`,
      `${view}-wos-enabled-input`,
      `${view}-clear-sound-input`,
      `${view}-wos-board-iframe`,
      `${view}-twitch-chat-widget`,
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    await expect(page.locator(`.${view}-wos-main-grid`)).toHaveCount(1);

    // Both views style the correct-words log through the same class (#207).
    // Pinned here because the two used to diverge — player carried
    // `player-correct-words-log` and bypassed the shared base entirely — and
    // nothing else would notice a per-view class creeping back in.
    await expect(page.locator('#correct-words-log')).toHaveClass('correct-words-log');

    // The ids the shared spectator drives stay unprefixed on both views, so
    // one script in wos-plus-main.ts can find them. Enumerated rather than
    // sampled, because #128 step 4 moved this markup into a component: the
    // pages no longer spell it out, so nothing else would notice a control
    // going missing from one view.
    for (const id of [
      'wos-board',
      'open-settings-btn',
      'correct-words-log',
      'level-title',
      'level-value',
      'pb-record',
      'pb-value',
      'daily-pb-record',
      'daily-pb-value',
      'daily-clear-record',
      'daily-clear-value',
      'letters-label',
      'letters',
      'hidden-letter',
      'fake-letter',
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
}
