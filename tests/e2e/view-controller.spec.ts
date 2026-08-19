import { test, expect, type Page } from '@playwright/test';
import { blockExternalNetwork } from './e2e-harness';

/**
 * Characterization coverage for the duplicated player/streamer view
 * controllers — step 1 of the staging plan on
 * https://github.com/clarkio/wos-plus/issues/128.
 *
 * These tests add no behaviour. They pin what `player.astro` and
 * `streamer.astro` do *today* so the ~630 duplicated lines those two files
 * share can be extracted later without the refactor silently changing
 * behaviour. Nothing here should be treated as an approved contract: where
 * the two views disagree, the tests say so explicitly and name the drift
 * rather than picking a winner (that decision belongs to #128).
 *
 * Why E2E rather than Vitest: both pages' client code lives in an inline
 * `<script>` block inside the `.astro` file, so there is no module for a unit
 * test to import. Extracting one is step 3 of #128 — which is exactly the
 * change this file exists to make safe. Until then this layer is the only
 * place the behaviour is reachable at all.
 */

const MIRROR_URL = 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6';
const TWITCH_CHANNEL = 'somestreamer';
const INVALID_MIRROR_URL = 'https://example.com/not-a-mirror';
const INVALID_CHANNEL = 'bad channel!';

interface ViewFixture {
  readonly path: string;
  readonly dialog: string;
  readonly boardIframe: string;
  readonly chatWidget: string;
  readonly grid: string;
  /**
   * Settings-form control ids. The prefixing is inconsistent between the two
   * views — streamer prefixes every control, player prefixes none — which is
   * the main mechanical blocker to sharing the script (#128, drift item 1).
   * Encoding it here rather than hiding it behind a helper keeps the
   * inconsistency visible until it is settled.
   */
  readonly mirrorUrlInput: string;
  readonly twitchChannelInput: string;
  readonly clearSoundInput: string;
}

const VIEWS: readonly ViewFixture[] = [
  {
    path: '/player',
    dialog: '#player-settings',
    boardIframe: '#player-wos-board-iframe',
    chatWidget: '#player-twitch-chat-widget',
    grid: '.player-wos-main-grid',
    mirrorUrlInput: '#mirror-url-input',
    twitchChannelInput: '#twitch-channel-input',
    clearSoundInput: '#clear-sound-input',
  },
  {
    path: '/streamer',
    dialog: '#streamer-settings',
    boardIframe: '#streamer-wos-board-iframe',
    chatWidget: '#streamer-twitch-chat-widget',
    grid: '.streamer-wos-main-grid',
    mirrorUrlInput: '#streamer-mirror-url-input',
    twitchChannelInput: '#streamer-twitch-channel-input',
    clearSoundInput: '#streamer-clear-sound-input',
  },
];

/**
 * `blockExternalNetwork` covers the hosts the *existing* suite reaches. These
 * tests additionally assert on the board iframe, whose `src` is set to the
 * live `wos.gg` mirror URL, and on the chat iframe pointed at `twitch.tv`, so
 * both are aborted here to keep this file hermetic under the same "zero real
 * network" convention (CLAUDE.md §7). Kept local to this spec rather than
 * added to the shared harness: widening the harness would change what the
 * existing specs exercise, which is out of scope for #128 step 1.
 */
async function armView(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.route('https://wos.gg/**', (route) => route.abort());
  await page.route('https://www.twitch.tv/embed/**', (route) => route.abort());
}

function pathWith(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

const validParams = (extra: Record<string, string> = {}) => ({
  mirrorUrl: MIRROR_URL,
  twitchChannel: TWITCH_CHANNEL,
  ...extra,
});

for (const view of VIEWS) {
  test.describe(`${view.path} view controller`, () => {
    test('opens the settings dialog when mirrorUrl is missing', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, { twitchChannel: TWITCH_CHANNEL }), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator(view.dialog)).toBeVisible();
      expect(await page.locator(view.boardIframe).getAttribute('src')).toBe('');
    });

    test('opens the settings dialog when twitchChannel is missing', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, { mirrorUrl: MIRROR_URL }), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator(view.dialog)).toBeVisible();
    });

    test('treats an invalid mirrorUrl as missing and never drives the board iframe', async ({
      page,
    }) => {
      await armView(page);
      await page.goto(
        pathWith(view.path, {
          mirrorUrl: INVALID_MIRROR_URL,
          twitchChannel: TWITCH_CHANNEL,
        }),
        { waitUntil: 'domcontentloaded' },
      );

      await expect(page.locator(view.dialog)).toBeVisible();
      // The guardrail in mirror-url.ts: a hand-crafted query string must not
      // be able to point the embedded board at an arbitrary page.
      expect(await page.locator(view.boardIframe).getAttribute('src')).toBe('');
    });

    test('loads the board iframe from a valid mirrorUrl', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, validParams()), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator(view.dialog)).not.toBeVisible();
      await expect(page.locator(view.boardIframe)).toHaveAttribute('src', MIRROR_URL);
    });

    test('board=false hides the board container and clears the iframe', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, validParams({ board: 'false' })), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator('#wos-board')).toBeHidden();
      // clearBoardIframe removes the attribute outright rather than blanking
      // it, so the browser drops the pending load.
      await expect
        .poll(() => page.locator(view.boardIframe).getAttribute('src'))
        .toBeNull();
    });

    test('board=true loads the board iframe', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, validParams({ board: 'true' })), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator('#wos-board')).toBeVisible();
      await expect(page.locator(view.boardIframe)).toHaveAttribute('src', MIRROR_URL);
    });

    test('chat=false hides the chat widget and marks the grid', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, validParams({ chat: 'false' })), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator(view.chatWidget)).toBeHidden();
      await expect(page.locator(view.grid)).toHaveClass(/chat-hidden/);
    });

    test('chat=true leaves the chat widget visible', async ({ page }) => {
      await armView(page);
      await page.goto(pathWith(view.path, validParams({ chat: 'true' })), {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator(view.chatWidget)).toBeVisible();
      await expect(page.locator(view.grid)).not.toHaveClass(/chat-hidden/);
    });

    test('re-populates the settings form when reopened from the settings button', async ({
      page,
    }) => {
      await armView(page);
      await page.goto(
        pathWith(view.path, validParams({ clearSound: 'false' })),
        { waitUntil: 'domcontentloaded' },
      );

      await expect(page.locator(view.dialog)).not.toBeVisible();
      await page.click('#open-settings-btn');

      await expect(page.locator(view.dialog)).toBeVisible();
      await expect(page.locator(view.mirrorUrlInput)).toHaveValue(MIRROR_URL);
      await expect(page.locator(view.twitchChannelInput)).toHaveValue(TWITCH_CHANNEL);
      await expect(page.locator(view.clearSoundInput)).not.toBeChecked();
    });
  });
}

/**
 * The two views disagree about what the auto-opened dialog shows back to the
 * user, because they pre-populate it from different code:
 *
 * - player.astro calls `populateSettingsFormFromUrl`, which guards on
 *   `urlParams.has(...)` — the raw value is echoed back even when invalid.
 * - streamer.astro re-implements the same logic inline inside
 *   `checkRequiredParams`, guarding on the *validated* `hasMirrorUrl` /
 *   `hasTwitchChannel` instead — so invalid input is silently discarded and
 *   the user is shown an empty form.
 *
 * That is #128 drift item 2. These two tests pin each side as it currently
 * behaves, under protest for the streamer case: losing what the user typed
 * looks like a defect, not a design choice. Deduplicating the two views will
 * force one behaviour on both, so the question has to be answered rather than
 * absorbed — whichever way it is settled, one of these tests must be updated
 * in the same PR as the fix, never deleted to get green (CLAUDE.md §2.2).
 */
test('/player echoes invalid parameters back into the dialog for correction', async ({ page }) => {
  await armView(page);
  await page.goto(
    pathWith('/player', {
      mirrorUrl: INVALID_MIRROR_URL,
      twitchChannel: INVALID_CHANNEL,
    }),
    { waitUntil: 'domcontentloaded' },
  );

  await expect(page.locator('#player-settings')).toBeVisible();
  await expect(page.locator('#mirror-url-input')).toHaveValue(INVALID_MIRROR_URL);
  await expect(page.locator('#twitch-channel-input')).toHaveValue(INVALID_CHANNEL);
});

test('/streamer discards invalid parameters, showing an empty dialog (known drift, #128)', async ({
  page,
}) => {
  await armView(page);
  await page.goto(
    pathWith('/streamer', {
      mirrorUrl: INVALID_MIRROR_URL,
      twitchChannel: INVALID_CHANNEL,
    }),
    { waitUntil: 'domcontentloaded' },
  );

  await expect(page.locator('#streamer-settings')).toBeVisible();
  await expect(page.locator('#streamer-mirror-url-input')).toHaveValue('');
  await expect(page.locator('#streamer-twitch-channel-input')).toHaveValue('');
});

/**
 * The chat/board toggles exist only in player's settings form, but both views
 * honour the `chat` and `board` query parameters in `initializePage` (pinned
 * above). So the streamer view supports the settings without exposing any way
 * to change them from its own dialog. #128 asks whether that asymmetry is
 * intended before the shared controller assumes either answer.
 */
test('/player exposes chat and board toggles in its settings form', async ({ page }) => {
  await armView(page);
  await page.goto('/player', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#player-settings')).toBeVisible();
  await expect(page.locator('#chat-enabled-input')).toHaveCount(1);
  await expect(page.locator('#wos-enabled-input')).toHaveCount(1);
});

test('/streamer has no chat or board toggles, though both query params still apply', async ({
  page,
}) => {
  await armView(page);
  await page.goto('/streamer', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#streamer-settings')).toBeVisible();
  await expect(page.locator('#chat-enabled-input')).toHaveCount(0);
  await expect(page.locator('#wos-enabled-input')).toHaveCount(0);
});
