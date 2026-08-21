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
  readonly view: string;
  readonly dialog: string;
  readonly boardIframe: string;
  readonly chatWidget: string;
  readonly grid: string;
  readonly mirrorUrlInput: string;
  readonly twitchChannelInput: string;
  readonly clearSoundInput: string;
  readonly chatEnabledInput: string;
  readonly boardEnabledInput: string;
}

/**
 * Every element either view owns is named `{view}-<thing>`, so the fixture is
 * derived from the view name rather than listing both by hand. That was not
 * possible before #128 step 2b: streamer prefixed its settings-form controls
 * and player did not, so the two had to be spelled out separately. If a future
 * change reintroduces a per-view exception, it has to be written down here as
 * an override — which is the point.
 *
 * The ids the shared spectator script drives (`#correct-words-log`,
 * `#level-value`, `#wos-board`) are deliberately *not* prefixed: they are the
 * same on both views because one script in wos-plus-main.ts looks them up.
 */
function viewFixture(path: string, view: string): ViewFixture {
  return {
    path,
    view,
    dialog: `#${view}-settings`,
    boardIframe: `#${view}-wos-board-iframe`,
    chatWidget: `#${view}-twitch-chat-widget`,
    grid: `.${view}-wos-main-grid`,
    mirrorUrlInput: `#${view}-mirror-url-input`,
    twitchChannelInput: `#${view}-twitch-channel-input`,
    clearSoundInput: `#${view}-clear-sound-input`,
    chatEnabledInput: `#${view}-chat-enabled-input`,
    boardEnabledInput: `#${view}-wos-enabled-input`,
  };
}

const VIEWS: readonly ViewFixture[] = [
  viewFixture('/player', 'player'),
  viewFixture('/streamer', 'streamer'),
];

/**
 * `blockExternalNetwork` now covers wos.gg too (#203), so the local route
 * this file used to carry for it is gone. The Twitch chat embed stays local:
 * unlike the blocked hosts it is not a suite-wide policy — `smoke.spec.ts`
 * deliberately lets the embed load when checking the page for console
 * errors — and these tests only assert on the iframe's `src` attribute.
 */
async function armView(page: Page): Promise<void> {
  await blockExternalNetwork(page);
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
 * Both views echo an unusable query parameter back into the dialog so the user
 * can see what was wrong and correct it, rather than being shown an empty form
 * (specs/settings.md, "what WoS+ shows back when a setting cannot be used").
 *
 * This was drift item 2 on #128: player called `populateSettingsFormFromUrl`
 * (guarding on `urlParams.has(...)`) while streamer re-implemented the same
 * logic inline inside `checkRequiredParams`, guarding on the *validated* value
 * and so silently discarding what the user typed. The maintainer confirmed the
 * two views should behave alike; streamer now shares player's behaviour.
 */
for (const view of VIEWS) {
  test(`${view.path} echoes invalid parameters back into the dialog for correction`, async ({
    page,
  }) => {
    await armView(page);
    await page.goto(
      pathWith(view.path, {
        mirrorUrl: INVALID_MIRROR_URL,
        twitchChannel: INVALID_CHANNEL,
      }),
      { waitUntil: 'domcontentloaded' },
    );

    await expect(page.locator(view.dialog)).toBeVisible();
    await expect(page.locator(view.mirrorUrlInput)).toHaveValue(INVALID_MIRROR_URL);
    await expect(page.locator(view.twitchChannelInput)).toHaveValue(INVALID_CHANNEL);
  });
}

/**
 * Both views expose the same settings (specs/settings.md, "the same settings
 * are available on both views"). The chat and board toggles used to exist only
 * in player's form even though both views honoured the `chat` and `board`
 * query parameters — #128 drift, resolved in favour of parity.
 */
for (const view of VIEWS) {
  test(`${view.path} exposes chat and board toggles in its settings form`, async ({ page }) => {
    await armView(page);
    await page.goto(view.path, { waitUntil: 'domcontentloaded' });

    await expect(page.locator(view.dialog)).toBeVisible();
    await expect(page.locator(view.chatEnabledInput)).toHaveCount(1);
    await expect(page.locator(view.boardEnabledInput)).toHaveCount(1);
  });

  test(`${view.path} settings dialog round-trips the chat toggle into URL params`, async ({
    page,
  }) => {
    await armView(page);
    await page.goto(view.path, { waitUntil: 'domcontentloaded' });

    await expect(page.locator(view.dialog)).toBeVisible();
    await page.fill(view.mirrorUrlInput, MIRROR_URL);
    await page.fill(view.twitchChannelInput, TWITCH_CHANNEL);
    // The toggle switch hides its native checkbox off-screen behind the
    // visible `.toggle-slider`; click the slider like a user would.
    await page.locator(`label:has(${view.chatEnabledInput}) .toggle-slider`).click();
    await expect(page.locator(view.chatEnabledInput)).not.toBeChecked();

    await page.click('.settings-dialog__save');
    await expect(page.locator(view.dialog)).not.toBeVisible();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('chat'))
      .toBe('false');
    const params = new URL(page.url()).searchParams;
    expect(params.get('board')).toBe('true');
    expect(params.get('mirrorUrl')).toBe(MIRROR_URL);
    expect(params.get('twitchChannel')).toBe(TWITCH_CHANNEL);
  });
}
