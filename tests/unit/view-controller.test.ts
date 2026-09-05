import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const connectToWosGame = vi.fn();
const connectToTwitch = vi.fn();
const spectatorInstances: Array<Record<string, unknown>> = [];

vi.mock('@scripts/wos-plus-main', () => ({
  GameSpectator: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.isSoundsEnabled = true;
    this.connectToWosGame = connectToWosGame;
    this.connectToTwitch = connectToTwitch;
    spectatorInstances.push(this);
  }),
}));

// The only network call the controller makes on its own behalf. `null` means
// "couldn't check", which the controller treats as not-a-reason-to-block —
// tests that care assert against an explicit true/false instead.
const twitchChannelExists = vi.fn(async () => null as boolean | null);
vi.mock('@scripts/twitch-channel', async (importActual) => ({
  ...(await importActual<typeof import('@scripts/twitch-channel')>()),
  twitchChannelExists,
}));

const { createViewController } = await import('@scripts/view-controller');
type SettingsFormData = import('@scripts/view-controller').SettingsFormData;
type ViewName = 'player' | 'streamer';

const MIRROR_URL = 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6';
const TWITCH_CHANNEL = 'somestreamer';
const INVALID_MIRROR_URL = 'https://example.com/not-a-mirror';
const INVALID_CHANNEL = 'bad channel!';

/**
 * Unit coverage for the shared view controller (issue #128 step 3).
 *
 * These are the characterization tests that lived in
 * `tests/e2e/view-controller.spec.ts` while both pages carried a duplicated
 * inline `<script>` and there was no module to import. Extracting
 * `view-controller.ts` is what lets them run here instead — faster, and
 * counted by coverage, which the inline scripts never were. CLAUDE.md §9
 * called for exactly this fold-back.
 *
 * What deliberately stays at the E2E layer: that each `.astro` page actually
 * *renders* the elements this controller looks up, and that the whole thing
 * works through a real Workers runtime. Neither is a claim about this module.
 */

/**
 * The markup both views render, reduced to the elements the controller
 * touches. Ids are `{view}-`-prefixed exactly as the pages emit them, except
 * the three the shared spectator drives, which are the same on both views.
 */
function renderView(view: ViewName): void {
  document.body.innerHTML = `
    <dialog id="${view}-settings">
      <form id="${view}-settings-form">
        <input type="url" id="${view}-mirror-url-input" name="mirrorUrl" />
        <small class="form-error" id="${view}-mirror-url-error" hidden></small>
        <input type="text" id="${view}-twitch-channel-input" name="twitchChannel" />
        <small class="form-error" id="${view}-twitch-channel-error" hidden></small>
        <input type="checkbox" id="${view}-chat-enabled-input" name="chatEnabled" />
        <input type="checkbox" id="${view}-wos-enabled-input" name="wosEnabled" checked />
        <input type="checkbox" id="${view}-clear-sound-input" name="clearSound" checked />
      </form>
    </dialog>
    <div class="${view}-wos-main-grid">
      <div class="${view}-wos-board-container" id="wos-board">
        <iframe id="${view}-wos-board-iframe" src=""></iframe>
      </div>
      <button id="open-settings-btn"></button>
      <iframe id="${view}-twitch-chat-widget" src=""></iframe>
      <div id="correct-words-log"></div>
    </div>
  `;
}

interface DialogApi {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onSave: (cb: (data: SettingsFormData) => unknown) => void;
  onCancel: (cb: () => unknown) => void;
  getData: () => SettingsFormData;
  /** The save handler the controller registered, for tests that drive Save. */
  save?: (data: SettingsFormData) => unknown;
}

/**
 * Stands in for `SettingsDialog.astro`'s `__api`, which the controller finds
 * on the dialog element. Attached before `initialize()` so the controller
 * takes the "API already there" path rather than waiting for `dialog-ready`.
 */
function attachDialogApi(view: ViewName): DialogApi {
  const api: DialogApi = {
    open: vi.fn(),
    close: vi.fn(),
    onSave: (cb) => { api.save = cb; },
    onCancel: () => {},
    getData: () => ({}),
  };
  const dialog = document.getElementById(`${view}-settings`) as HTMLDialogElement;
  (dialog as unknown as { __api: DialogApi }).__api = api;
  return api;
}

function setSearch(params: Record<string, string>): void {
  const query = new URLSearchParams(params).toString();
  window.history.replaceState({}, '', query ? `/?${query}` : '/');
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  spectatorInstances.length = 0;
  twitchChannelExists.mockResolvedValue(null);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setSearch({});
});

/**
 * `checkRequiredParams` opens the dialog behind a `setTimeout` chain, so the
 * assertions have to let those timers run.
 */
function initializeAndSettle(view: ViewName): void {
  createViewController(view).initialize();
  vi.advanceTimersByTime(500);
}

for (const view of ['player', 'streamer'] as const) {
  describe(`${view} view controller`, () => {
    beforeEach(() => {
      renderView(view);
    });

    describe('required parameters', () => {
      it('opens the settings dialog when mirrorUrl is missing', () => {
        setSearch({ twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);

        initializeAndSettle(view);

        expect(api.open).toHaveBeenCalled();
        expect(connectToWosGame).not.toHaveBeenCalled();
      });

      it('opens the settings dialog when twitchChannel is missing', () => {
        setSearch({ mirrorUrl: MIRROR_URL });
        const api = attachDialogApi(view);

        initializeAndSettle(view);

        expect(api.open).toHaveBeenCalled();
        expect(connectToTwitch).not.toHaveBeenCalled();
      });

      it('treats an invalid mirrorUrl as missing and never drives the board iframe', () => {
        setSearch({ mirrorUrl: INVALID_MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);

        initializeAndSettle(view);

        expect(api.open).toHaveBeenCalled();
        // The guardrail in mirror-url.ts: a hand-crafted query string must not
        // be able to point the embedded board at an arbitrary page.
        expect(
          document.getElementById(`${view}-wos-board-iframe`)?.getAttribute('src'),
        ).toBe('');
      });

      it('connects and loads the board when both parameters are valid', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);

        initializeAndSettle(view);

        expect(api.open).not.toHaveBeenCalled();
        expect(connectToWosGame).toHaveBeenCalledWith(MIRROR_URL);
        expect(connectToTwitch).toHaveBeenCalledWith(TWITCH_CHANNEL);
        expect(
          document.getElementById(`${view}-wos-board-iframe`)?.getAttribute('src'),
        ).toBe(MIRROR_URL);
      });
    });

    describe('board visibility', () => {
      it('board=false hides the container and clears the iframe', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, board: 'false' });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect((document.getElementById('wos-board') as HTMLElement).style.display).toBe('none');
        // clearBoardIframe removes the attribute outright rather than blanking
        // it, so the browser drops the pending load.
        expect(document.getElementById(`${view}-wos-board-iframe`)?.hasAttribute('src')).toBe(false);
      });

      it('board=true loads the board iframe', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, board: 'true' });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect((document.getElementById('wos-board') as HTMLElement).style.display).not.toBe('none');
        expect(
          document.getElementById(`${view}-wos-board-iframe`)?.getAttribute('src'),
        ).toBe(MIRROR_URL);
      });
    });

    describe('chat visibility', () => {
      it('chat=false hides the chat widget and marks the grid', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, chat: 'false' });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect((document.getElementById(`${view}-twitch-chat-widget`) as HTMLElement).style.display).toBe('none');
        expect(
          document.querySelector(`.${view}-wos-main-grid`)?.classList.contains('chat-hidden'),
        ).toBe(true);
      });

      it('chat=true leaves the chat widget visible', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, chat: 'true' });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect((document.getElementById(`${view}-twitch-chat-widget`) as HTMLElement).style.display).not.toBe('none');
        expect(
          document.querySelector(`.${view}-wos-main-grid`)?.classList.contains('chat-hidden'),
        ).toBe(false);
      });
    });

    describe('settings form', () => {
      it('re-populates from the URL when reopened via the settings button', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, clearSound: 'false' });
        const api = attachDialogApi(view);
        initializeAndSettle(view);

        document.getElementById('open-settings-btn')?.dispatchEvent(new Event('click'));

        expect(api.open).toHaveBeenCalled();
        expect(input(`${view}-mirror-url-input`).value).toBe(MIRROR_URL);
        expect(input(`${view}-twitch-channel-input`).value).toBe(TWITCH_CHANNEL);
        expect(input(`${view}-clear-sound-input`).checked).toBe(false);
      });

      // Both views echo an unusable parameter back rather than discarding it,
      // so the user can see what was wrong and correct it. This was drift
      // between the two views until #205 (specs/settings.md, "what WoS+ shows
      // back when a setting cannot be used").
      it('echoes invalid parameters back into the dialog for correction', () => {
        setSearch({ mirrorUrl: INVALID_MIRROR_URL, twitchChannel: INVALID_CHANNEL });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect(input(`${view}-mirror-url-input`).value).toBe(INVALID_MIRROR_URL);
        expect(input(`${view}-twitch-channel-input`).value).toBe(INVALID_CHANNEL);
      });

      it('defaults all three toggles to on when the URL says nothing about them', () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        attachDialogApi(view);

        initializeAndSettle(view);

        expect(input(`${view}-chat-enabled-input`).checked).toBe(true);
        expect(input(`${view}-wos-enabled-input`).checked).toBe(true);
        expect(input(`${view}-clear-sound-input`).checked).toBe(true);
      });
    });

    describe('saving', () => {
      it('writes every setting into the URL and applies it in place', async () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);
        initializeAndSettle(view);
        twitchChannelExists.mockResolvedValue(true);

        await api.save?.({
          mirrorUrl: MIRROR_URL,
          twitchChannel: TWITCH_CHANNEL,
          chatEnabled: false,
          wosEnabled: true,
          clearSound: false,
        });

        const params = new URLSearchParams(window.location.search);
        expect(params.get('mirrorUrl')).toBe(MIRROR_URL);
        expect(params.get('twitchChannel')).toBe(TWITCH_CHANNEL);
        expect(params.get('chat')).toBe('false');
        expect(params.get('board')).toBe('true');
        expect(params.get('clearSound')).toBe('false');
        expect(
          (document.getElementById(`${view}-twitch-chat-widget`) as HTMLElement).style.display,
        ).toBe('none');
      });

      it('rejects an unusable mirror URL, showing the error and changing nothing', async () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);
        initializeAndSettle(view);
        connectToWosGame.mockClear();

        const result = await api.save?.({ mirrorUrl: INVALID_MIRROR_URL });

        // Returning false is what keeps the dialog open.
        expect(result).toBe(false);
        expect(document.getElementById(`${view}-mirror-url-error`)?.hasAttribute('hidden')).toBe(false);
        expect(connectToWosGame).not.toHaveBeenCalled();
      });

      it('rejects a channel name that belongs to no Twitch account', async () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);
        initializeAndSettle(view);
        connectToTwitch.mockClear();
        twitchChannelExists.mockResolvedValue(false);

        const result = await api.save?.({ twitchChannel: 'nosuchchannel' });

        expect(result).toBe(false);
        expect(document.getElementById(`${view}-twitch-channel-error`)?.hasAttribute('hidden')).toBe(false);
        expect(connectToTwitch).not.toHaveBeenCalled();
      });

      it('does not block saving when the channel lookup cannot be completed', async () => {
        setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
        const api = attachDialogApi(view);
        initializeAndSettle(view);
        connectToTwitch.mockClear();
        // `null` means the lookup itself failed — not evidence the channel is
        // wrong, so it must not stop the save (specs/settings.md).
        twitchChannelExists.mockResolvedValue(null);

        const result = await api.save?.({ twitchChannel: 'someoneelse' });

        expect(result).not.toBe(false);
        expect(connectToTwitch).toHaveBeenCalledWith('someoneelse');
      });
    });
  });
}

describe('view controller lifecycle', () => {
  beforeEach(() => {
    renderView('player');
  });

  it('constructs one spectator per controller, however often it initializes', () => {
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
    attachDialogApi('player');
    const controller = createViewController('player');

    controller.initialize();
    controller.initialize();
    vi.advanceTimersByTime(500);

    // initialize() runs on every astro:page-load; the spectator owns the live
    // connections and must not be rebuilt underneath them.
    expect(spectatorInstances).toHaveLength(1);
  });

  it('drives the board in a replaced document, not the one it was built against', () => {
    // Regression for the review finding on #213: `boardContainer` and
    // `boardIframe` used to be resolved once when the controller was built,
    // while `initialize()` runs again on every `astro:page-load` — where Astro
    // swaps the document body. The controller would then mutate detached
    // nodes and the visible board would stop responding to `board`.
    //
    // Latent rather than live today (nothing enables `ClientRouter`), which is
    // exactly why it needs a test: no existing one re-renders between calls,
    // so nothing would notice if the lookups were captured again.
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, board: 'false' });
    attachDialogApi('player');
    const controller = createViewController('player');
    controller.initialize();
    vi.advanceTimersByTime(500);

    // Stand in for a client-side navigation: same markup, all-new nodes.
    renderView('player');
    attachDialogApi('player');
    controller.initialize();
    vi.advanceTimersByTime(500);

    expect((document.getElementById('wos-board') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('player-wos-board-iframe')?.hasAttribute('src')).toBe(false);
  });

  it('picks up the dialog API from the dialog-ready event when it is not there yet', () => {
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
    const controller = createViewController('player');

    controller.initialize();
    const api = attachDialogApi('player');
    document.getElementById('player-settings')?.dispatchEvent(new Event('dialog-ready'));
    document.getElementById('open-settings-btn')?.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(500);

    expect(api.open).toHaveBeenCalled();
  });
});

describe('view controller resilience and connection churn', () => {
  // ⚠️ Pins current behaviour under protest — known gap (#204).
  //
  // Most of this module guards its lookups (`applyChatVisibility` casts to
  // `HTMLIFrameElement | null` and returns early when either element is
  // missing), but `initializePage` re-implements the same work inline and
  // casts to a non-null type it never checks — so a page missing
  // `#{view}-twitch-chat-widget` throws on load instead of degrading.
  //
  // That is exactly the duplication #204 tracks, and extracting this module
  // is what made it reproducible in a unit test for the first time: the
  // defect was unreachable while the code lived in an inline `<script>` with
  // no importable surface. Fixing it is #204's job, not this PR's.
  //
  // **When #204 lands, invert this assertion in the same PR** — do not delete
  // it to get green (CLAUDE.md §2.2, §7).
  it('throws when the page is missing the elements it drives (known gap #204)', () => {
    document.body.innerHTML = '<div></div>';
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });

    expect(() => {
      createViewController('player').initialize();
      vi.advanceTimersByTime(500);
    }).toThrow(TypeError);
  });

  it('re-points the chat embed only when the channel actually changes', async () => {
    renderView('player');
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
    const api = attachDialogApi('player');
    initializeAndSettle('player');
    twitchChannelExists.mockResolvedValue(true);

    const widget = document.getElementById('player-twitch-chat-widget') as HTMLIFrameElement;
    const srcAfterInit = widget.src;

    // Saving the same channel must not reload the iframe...
    await api.save?.({ twitchChannel: TWITCH_CHANNEL });
    expect(widget.src).toBe(srcAfterInit);

    // ...but a different one must.
    await api.save?.({ twitchChannel: 'anotherstreamer' });
    expect(widget.src).toContain('anotherstreamer');
  });

  it('reconnects on every save even when nothing changed', async () => {
    // Deliberate: the dialog applies settings in place rather than reloading,
    // so these reconnects are the only thing that picks up new settings, and
    // saving is also how a user recovers a dropped connection (issue #88).
    renderView('player');
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
    const api = attachDialogApi('player');
    initializeAndSettle('player');
    connectToWosGame.mockClear();
    connectToTwitch.mockClear();
    twitchChannelExists.mockResolvedValue(true);

    await api.save?.({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });

    expect(connectToWosGame).toHaveBeenCalledWith(MIRROR_URL);
    expect(connectToTwitch).toHaveBeenCalledWith(TWITCH_CHANNEL);
  });

  it('carries the clearSound parameter into the spectator', () => {
    renderView('streamer');
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL, clearSound: 'false' });
    attachDialogApi('streamer');

    initializeAndSettle('streamer');

    expect(spectatorInstances[0].isSoundsEnabled).toBe(false);
  });

  it('leaves the board loaded when the URL says nothing about it', () => {
    renderView('streamer');
    setSearch({ mirrorUrl: MIRROR_URL, twitchChannel: TWITCH_CHANNEL });
    attachDialogApi('streamer');

    initializeAndSettle('streamer');

    expect(
      document.getElementById('streamer-wos-board-iframe')?.getAttribute('src'),
    ).toBe(MIRROR_URL);
  });
});
