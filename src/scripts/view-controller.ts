import { GameSpectator } from './wos-plus-main';
import { normalizeMirrorUrl } from './mirror-url';
import { normalizeTwitchLogin, twitchChannelExists } from './twitch-channel';

/**
 * The shared controller behind the player and streamer views (issue #128).
 *
 * Both pages ran a byte-for-byte identical ~470-line inline `<script>`,
 * differing only in the `player-`/`streamer-` prefix on the elements they own.
 * This is that script, lifted once and parameterised by the view name.
 */

/**
 * Which of the two game views is being driven.
 *
 * A union rather than a plain string on purpose: the two values here are the
 * views that *play or stream the game*, and they are expected to stay at
 * feature parity. Planned administration views (global admin, per-channel
 * streamer configuration) are a different kind of page and will not run this
 * controller — so adding to this union should be a deliberate act, not
 * something that happens by passing a new string.
 */
export type ViewName = 'player' | 'streamer';

/**
 * The API `src/components/SettingsDialog.astro` attaches to its `<dialog>`
 * element as `__api`, and announces with a `dialog-ready` event.
 *
 * Declared here rather than exported from the component because an `.astro`
 * component has no importable type surface. If the component's API changes,
 * this must change with it — there is no compiler link between the two.
 */
/**
 * What the settings form yields on save.
 *
 * `SettingsDialog.astro`'s `getData()` returns one entry per named input, so
 * these are the five `name=` attributes both views' forms declare — checkbox
 * inputs as booleans, text inputs as strings. Every field is optional because
 * `getData()` reports only the inputs a page actually rendered.
 */
export interface SettingsFormData {
  mirrorUrl?: string;
  twitchChannel?: string;
  chatEnabled?: boolean;
  wosEnabled?: boolean;
  clearSound?: boolean;
}

export interface SettingsDialogApi {
  open: () => void;
  close: () => void;
  onSave: (callback: (data: SettingsFormData) => unknown) => void;
  onCancel: (callback: () => unknown) => void;
  getData: () => SettingsFormData;
}

/** A `<dialog>` that may have had its settings API attached yet. */
type SettingsDialogElement = HTMLDialogElement & { __api?: SettingsDialogApi };

export interface ViewController {
  /**
   * Wires the settings dialog, applies the query parameters, and connects to
   * the game and to Twitch. Safe to call repeatedly: it is what runs on every
   * `astro:page-load`, not only the first.
   */
  initialize(): void;
}

/**
 * Builds a controller for `view` against the DOM as it currently stands.
 *
 * Element lookups that identify a *view-owned* element are derived from
 * `view` (`#player-settings`, `.streamer-wos-main-grid`, …). Three ids are
 * deliberately shared and referenced literally — `#wos-board`,
 * `#open-settings-btn`, and the ids `wos-plus-main.ts` drives
 * (`#correct-words-log`, `#level-value`) — because one script looks them up
 * across both views.
 *
 * The `GameSpectator` is constructed here, once per controller, while
 * `initialize()` may run many times. `mountViewController` preserves that
 * boundary; a caller building its own controller must too.
 */
export function createViewController(view: ViewName): ViewController {

    // Resolved per call, not captured once. `initialize()` runs on every
    // `astro:page-load`, where Astro replaces the document body — a reference
    // captured here would point at a detached node from the second navigation
    // onward, and the board would silently stop responding to the `board`
    // parameter. Nothing enables `ClientRouter` today, so that path is latent
    // rather than live, but every other lookup in this module is already lazy
    // and this pair was the sole exception (carried over from the inline page
    // scripts).
    const boardContainerEl = () =>
      document.getElementById("wos-board") as HTMLDivElement | null;
    const boardIframeEl = () =>
      document.getElementById(
        `${view}-wos-board-iframe`,
      ) as HTMLIFrameElement | null;
    let currentMirrorUrl = "";
    let twitchChannel = "clarkio";

    const mirrorUrlErrorEl = () =>
      document.getElementById(`${view}-mirror-url-error`);
    const mirrorUrlInputEl = () =>
      document.getElementById(`${view}-mirror-url-input`) as HTMLInputElement | null;

    const showMirrorUrlError = () => {
      mirrorUrlErrorEl()?.removeAttribute("hidden");
      mirrorUrlInputEl()?.classList.add("input-invalid");
    };

    const clearMirrorUrlError = () => {
      mirrorUrlErrorEl()?.setAttribute("hidden", "");
      mirrorUrlInputEl()?.classList.remove("input-invalid");
    };

    const twitchChannelErrorEl = () =>
      document.getElementById(`${view}-twitch-channel-error`);
    const twitchChannelInputEl = () =>
      document.getElementById(`${view}-twitch-channel-input`) as HTMLInputElement | null;

    const showTwitchChannelError = (message?: string) => {
      const errorEl = twitchChannelErrorEl();
      if (errorEl && message) {
        errorEl.textContent = message;
      }
      errorEl?.removeAttribute("hidden");
      twitchChannelInputEl()?.classList.add("input-invalid");
    };

    const clearTwitchChannelError = () => {
      twitchChannelErrorEl()?.setAttribute("hidden", "");
      twitchChannelInputEl()?.classList.remove("input-invalid");
    };

    // Shared view-controller extraction is tracked by #128. Validation and
    // canonical casing live in normalizeTwitchLogin (#133).
    const extractTwitchChannel = (input: string): string => {
      const trimmed = input.trim();
      if (!trimmed) return "";
      const match = trimmed.match(/(?:[a-z0-9-]+\.)?twitch\.tv\/([^/?#]+)/i);
      return match ? match[1] : trimmed;
    };

    const isBoardVisible = () => {
      const boardContainer = boardContainerEl();
      // No container at all counts as visible: the caller's next guard is on
      // the iframe, which is the thing that actually matters.
      return boardContainer
        ? window.getComputedStyle(boardContainer).display !== "none"
        : true;
    };

    const loadBoardIframeIfVisible = () => {
      const boardIframe = boardIframeEl();
      if (!boardIframe || !currentMirrorUrl || !isBoardVisible()) {
        return;
      }

      if (boardIframe.getAttribute("src") !== currentMirrorUrl) {
        boardIframe.setAttribute("src", currentMirrorUrl);
      }
    };

    const clearBoardIframe = () => {
      const boardIframe = boardIframeEl();
      if (!boardIframe) {
        return;
      }

      if (boardIframe.hasAttribute("src")) {
        boardIframe.removeAttribute("src");
      }
    };

    const spectator = new GameSpectator();

    // Initialize dialog API reference
    let settingsDialog: SettingsDialogApi | null = null;

    const populateSettingsFormFromUrl = (urlParams: URLSearchParams) => {
      const mirrorUrlInput = document.getElementById(
        `${view}-mirror-url-input`,
      ) as HTMLInputElement | null;
      const twitchChannelInput = document.getElementById(
        `${view}-twitch-channel-input`,
      ) as HTMLInputElement | null;
      const chatEnabledInput = document.getElementById(
        `${view}-chat-enabled-input`,
      ) as HTMLInputElement | null;
      const wosEnabledInput = document.getElementById(
        `${view}-wos-enabled-input`,
      ) as HTMLInputElement | null;
      const clearSoundInput = document.getElementById(
        `${view}-clear-sound-input`,
      ) as HTMLInputElement | null;

      if (mirrorUrlInput && urlParams.has("mirrorUrl")) {
        mirrorUrlInput.value = urlParams.get("mirrorUrl") || "";
      }

      if (twitchChannelInput && urlParams.has("twitchChannel")) {
        twitchChannelInput.value = urlParams.get("twitchChannel") || "";
      }

      if (chatEnabledInput) {
        const chatParam = urlParams.get("chat");
        chatEnabledInput.checked = chatParam
          ? chatParam.toLowerCase() === "true"
          : true;
      }

      if (wosEnabledInput) {
        const boardParam = urlParams.get("board");
        wosEnabledInput.checked = boardParam
          ? boardParam.toLowerCase() === "true"
          : true;
      }

      if (clearSoundInput) {
        const clearSoundParam = urlParams.get("clearSound");
        clearSoundInput.checked = clearSoundParam
          ? clearSoundParam.toLowerCase() === "true"
          : true;
      }
    };

    const initializeSettingsDialog = () => {
      const dialog = document.getElementById(`${view}-settings`) as SettingsDialogElement | null;

      if (dialog && dialog.__api) {
        settingsDialog = dialog.__api;
      }
    };

    const applyChatVisibility = (isChatEnabled: boolean) => {
      const twitchChatWidget = document.getElementById(
        `${view}-twitch-chat-widget`,
      ) as HTMLIFrameElement | null;
      const grid = document.querySelector<HTMLElement>(`.${view}-wos-main-grid`);
      if (!twitchChatWidget || !grid) return;
      if (isChatEnabled) {
        twitchChatWidget.style.display = "";
        grid.classList.remove("chat-hidden");
      } else {
        twitchChatWidget.style.display = "none";
        grid.classList.add("chat-hidden");
      }
    };

    /** Points the chat embed at whatever `twitchChannel` currently holds. */
    const pointChatEmbedAtChannel = () => {
      const twitchChatWidget = document.getElementById(
        `${view}-twitch-chat-widget`,
      ) as HTMLIFrameElement | null;
      if (!twitchChatWidget) return;
      twitchChatWidget.src = `https://www.twitch.tv/embed/${twitchChannel}/chat?darkpopout&parent=${location.hostname}`;
    };

    const applyBoardVisibility = (boardEnabled: boolean) => {
      const boardContainer = boardContainerEl();
      if (!boardContainer) return;
      if (boardEnabled) {
        boardContainer.style.display = "";
        loadBoardIframeIfVisible();
      } else {
        boardContainer.style.display = "none";
        clearBoardIframe();
      }
    };

    // Separate function to set up save callback
    const setupDialogCallbacks = () => {
      if (!settingsDialog) return;

      // Set up save callback
      settingsDialog.onSave(async (data: SettingsFormData) => {
        // Validate the mirror URL before applying anything. Only official WoS
        // mirror links (https://wos.gg/r/<gameId>) are allowed — anything else
        // (other sites, other paths) is rejected so the board iframe can't be
        // pointed at an arbitrary page. Returning false keeps the dialog open.
        let normalizedMirrorUrl = currentMirrorUrl;
        if (data.mirrorUrl) {
          const candidate = normalizeMirrorUrl(data.mirrorUrl);
          if (!candidate) {
            showMirrorUrlError();
            return false;
          }
          normalizedMirrorUrl = candidate;
        }
        clearMirrorUrlError();

        // Validate the Twitch channel. A malformed or nonexistent channel name
        // otherwise leaves the chat embed stuck on "Connecting to chat" with no
        // indication of why (issue #103), so reject it here instead.
        let newChannel = twitchChannel;
        if (data.twitchChannel) {
          const channel = normalizeTwitchLogin(
            extractTwitchChannel(data.twitchChannel),
          );
          if (!channel) {
            showTwitchChannelError("Enter a valid Twitch channel name.");
            return false;
          }

          const exists = await twitchChannelExists(channel);
          if (exists === false) {
            showTwitchChannelError(
              `No Twitch channel found named "${channel}".`,
            );
            return false;
          }
          // `exists === null` means the check couldn't be completed (e.g. the
          // lookup service is unreachable) — don't block saving on that.

          clearTwitchChannelError();
          newChannel = channel;
        } else {
          clearTwitchChannelError();
        }

        const params = new URLSearchParams(window.location.search);

        // Update the settings parameters with the canonical mirror URL
        if (data.mirrorUrl) {
          params.set("mirrorUrl", normalizedMirrorUrl);
        }
        params.set("twitchChannel", newChannel);
        // Handle chat enabled toggle
        params.set("chat", data.chatEnabled ? "true" : "false");
        // Handle WoS board visibility toggle
        params.set("board", data.wosEnabled ? "true" : "false");
        // Handle clear sound toggle
        params.set("clearSound", data.clearSound ? "true" : "false");

        // Update the URL without a full page reload. A reload would discard the
        // user activation from the Save click, which the browser's autoplay
        // policy requires for `audio.play()` calls to succeed.
        const newUrl = window.location.pathname + "?" + params.toString();
        window.history.replaceState({}, "", newUrl);

        // Apply settings in place
        const mirrorUrlChanged = normalizedMirrorUrl !== currentMirrorUrl;
        currentMirrorUrl = normalizedMirrorUrl;

        applyChatVisibility(!!data.chatEnabled);
        applyBoardVisibility(!!data.wosEnabled);
        spectator.isSoundsEnabled = !!data.clearSound;

        const channelChanged = newChannel !== twitchChannel;
        twitchChannel = newChannel;

        // Only swap the chat embed when the channel actually changed to avoid an
        // unnecessary reload of the iframe.
        if (channelChanged) {
          pointChatEmbedAtChannel();
        }

        // Only re-point the board iframe when the mirror URL actually changed.
        if (mirrorUrlChanged) {
          loadBoardIframeIfVisible();
        }

        // Always tear down and re-establish the live connections on save. The
        // dialog now applies settings in place instead of reloading the page, so
        // these reconnects are the only thing that picks up the new settings.
        // connectToTwitch/connectToWosGame each close any previous connection
        // before opening a new one, so saving reliably reconnects even when the
        // value itself is unchanged (issue #88).
        spectator.connectToTwitch(twitchChannel);
        if (currentMirrorUrl) {
          spectator.connectToWosGame(currentMirrorUrl);
        }
      });
    };

    const checkRequiredParams = (
      urlParams: URLSearchParams,
      normalizedChannel: string | null,
    ) => {
      // Treat a missing OR invalid mirror URL the same: prompt via the dialog so
      // a hand-crafted/legacy query string can never drive the board iframe.
      const hasMirrorUrl = !!normalizeMirrorUrl(urlParams.get("mirrorUrl") || "");
      const hasTwitchChannel = normalizedChannel !== null;

      // If either parameter is missing, show the settings dialog
      if (!hasMirrorUrl || !hasTwitchChannel) {
        // Pre-populate any existing values
        populateSettingsFormFromUrl(urlParams);

        // Ensure dialog is ready and set up callbacks before opening
        const attemptOpenDialog = () => {
          const dialog = document.getElementById(`${view}-settings`) as SettingsDialogElement | null;
          if (dialog && dialog.__api) {
            settingsDialog = dialog.__api;
            setupDialogCallbacks();
            settingsDialog.open();
          } else {
            // If dialog not ready, try again shortly
            setTimeout(attemptOpenDialog, 50);
          }
        };

        setTimeout(attemptOpenDialog, 100);

        return false;
      }

      return true;
    };

    // Function to initialize the page
    const initializePage = () => {
      // Reset dialog reference on each navigation
      settingsDialog = null;

      // Initialize settings dialog
      const dialog = document.getElementById(`${view}-settings`) as SettingsDialogElement | null;
      if (dialog) {
        // Try to get the API immediately if it exists
        if (dialog.__api) {
          settingsDialog = dialog.__api;
          setupDialogCallbacks();
        } else {
          // If not ready yet, wait for the event
          dialog.addEventListener(
            "dialog-ready",
            () => {
              initializeSettingsDialog();
              setupDialogCallbacks();
            },
            { once: true },
          );
        }
      }

      // Set up settings button click handler
      const settingsBtn = document.getElementById("open-settings-btn");
      if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
          // Ensure dialog is ready and callbacks are set up
          if (!settingsDialog && dialog && dialog.__api) {
            settingsDialog = dialog.__api;
            setupDialogCallbacks();
          }
          if (settingsDialog) {
            // Populate current values before opening
            const urlParams = new URLSearchParams(window.location.search);
            populateSettingsFormFromUrl(urlParams);
            settingsDialog.open();
          }
        });
      }

      // check for query parameters in the url
      const urlParams = new URLSearchParams(window.location.search);
      populateSettingsFormFromUrl(urlParams);

      const normalizedChannelFromParams = normalizeTwitchLogin(
        extractTwitchChannel(urlParams.get("twitchChannel") || ""),
      );

      // Check if required parameters are present and valid (this will trigger
      // the dialog if needed).
      const hasRequiredParams = checkRequiredParams(
        urlParams,
        normalizedChannelFromParams,
      );

      const normalizedFromParams = normalizeMirrorUrl(
        urlParams.get("mirrorUrl") || "",
      );
      if (normalizedFromParams) {
        currentMirrorUrl = normalizedFromParams;
        loadBoardIframeIfVisible();
      }

      if (urlParams.has("chat")) {
        applyChatVisibility(urlParams.get("chat")?.toLowerCase() === "true");
      }

      if (normalizedChannelFromParams) {
        twitchChannel = normalizedChannelFromParams;
        pointChatEmbedAtChannel();
      }

      // Only connect if we have required parameters
      if (hasRequiredParams) {
        // Handle clear sound setting
        if (urlParams.has("clearSound")) {
          spectator.isSoundsEnabled =
            urlParams.get("clearSound")?.toLowerCase() === "true";
        }

        spectator.connectToWosGame(currentMirrorUrl);
        spectator.connectToTwitch(twitchChannel);
      }

      if (urlParams.has("board")) {
        applyBoardVisibility(urlParams.get("board")?.toLowerCase() === "true");
      } else {
        // No preference expressed: the board stays as the markup rendered it.
        loadBoardIframeIfVisible();
      }
    };

  return { initialize: initializePage };
}

/**
 * Creates a controller for `view` and wires it to the page lifecycle.
 *
 * Both events matter: `DOMContentLoaded` for a normal load, and
 * `astro:page-load` for a client-side navigation, where the DOM is replaced
 * but this module is not re-executed.
 */
export function mountViewController(view: ViewName): void {
  const controller = createViewController(view);
  document.addEventListener('DOMContentLoaded', () => {
    controller.initialize();
  });
  document.addEventListener('astro:page-load', () => {
    controller.initialize();
  });
}
