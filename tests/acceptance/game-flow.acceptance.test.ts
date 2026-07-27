/**
 * ============================================================================
 * Acceptance tests for the game flow — `GameSpectator`
 * ============================================================================
 *
 * Spec: [specs/game-flow.md](../../specs/game-flow.md)
 *
 * Every `describe` below names the spec section it implements, so the mapping
 * from approved scenario to executable assertion is mechanical.
 *
 * ---------------------------------------------------------------------------
 * Why this file runs in happy-dom and not in node
 * ---------------------------------------------------------------------------
 *
 * The other acceptance files pin themselves to the node environment because
 * they exercise server code. `GameSpectator` is the opposite: it is the browser
 * half of WoS+, and what a viewer "sees" *is* the DOM it writes — the level
 * badge, the letters row, the found-words log, the game log. So this file uses
 * the repo default (happy-dom) and asserts on those elements rather than on
 * calls into the class.
 *
 * (This file therefore carries no environment pragma. Do not add one — and note
 * that even naming the pragma inside a comment here would switch the whole file
 * to node and break every assertion below.)
 *
 * ---------------------------------------------------------------------------
 * How a scenario is driven
 * ---------------------------------------------------------------------------
 *
 * A real game reaches `GameSpectator` along one path:
 *
 *     WoS socket → wosWorker.postMessage({ eventType, data })
 *                → wos-worker.ts
 *                → postMessage(result)
 *                → GameSpectator's `wosWorker.onmessage`
 *
 * `playWosEvent()` walks that whole path: it feeds a raw socket payload (the
 * `{ eventType, data }` shape recorded in `tests/fixtures/wos-events/`) to the
 * **real** `wos-worker.ts` module and hands the worker's own output to the
 * spectator. Nothing about the translation is faked, so a scenario written here
 * is the sequence of events a stream would actually produce.
 *
 * Twitch chat arrives the same way, through the twitch worker's `onmessage`.
 *
 * ---------------------------------------------------------------------------
 * Network
 * ---------------------------------------------------------------------------
 *
 * Only HTTP is faked, via the shared MSW server in `network-mock.ts` — the same
 * rule as the API acceptance files: mock the boundary, never the module. The
 * real `db-service.ts` runs (board pre-check, POST, channel stats) and the real
 * `wos-words.ts` dictionary is loaded over `/api/words`, so word matching and
 * missed-word detection are the production code paths, not stubs.
 *
 * `network-mock.ts` fails any test that makes an unmatched request, which means
 * "no handler registered" doubles as an assertion that no call was made.
 *
 * ---------------------------------------------------------------------------
 * Timing
 * ---------------------------------------------------------------------------
 *
 * The spectator deliberately delays: ~400ms before applying a correct guess,
 * ~500ms of grace at level end so a buzzer-beater guess still lands, and 1.5s
 * before re-reading the channel records. Those delays are behaviour (see
 * `§ Ending a level`), so they are not stubbed out — `drain()` runs the fake
 * clock forward and lets the interleaved fetches settle instead.
 *
 * ---------------------------------------------------------------------------
 * ❓ Unconfirmed things this file deliberately does NOT settle
 * ---------------------------------------------------------------------------
 *
 * 1. **Where masking begins.** `specs/game-flow.md § Masked guesses` flags that
 *    the code comments say level 19 and `copilot-instructions.md` says level 20.
 *    Neither is enforced: `updateGameState` branches purely on the word
 *    containing '?', with no reference to `currentLevel` at all. There is a test
 *    below pinning exactly that, because "test what the code does" is the only
 *    honest option while two documents disagree.
 *
 * 2. **The shape of an unguessed slot.** `tests/fixtures/wos-events/README.md`
 *    marks the slot element shape as INFERRED. The fixtures use `letters: []`
 *    for an unguessed slot; `db-service.saveBoard` rejects boards whose slots
 *    contain '.', which implies WoS actually sends a `['.', '.', …]` placeholder
 *    of the slot's length. That difference is load-bearing — see the pinned test
 *    in `§ Ending a level`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { GameSpectator } from '@scripts/wos-plus-main';
import type { WosWorkerMessage, WosWorkerResult } from '@scripts/wos-worker';
import { loadWordsFromDb } from '@scripts/wos-words';

import { server, setupNetworkMocking } from './network-mock';

import levelStartFixture from '../fixtures/wos-events/01-level-start.json';
import correctGuessFixture from '../fixtures/wos-events/03-correct-guess.json';
import gameEndedFixture from '../fixtures/wos-events/05-game-ended.json';
import lettersRevealedFixture from '../fixtures/wos-events/10-letters-revealed.json';
import gameConnectedFixture from '../fixtures/wos-events/12-game-connected.json';

setupNetworkMocking();

// ---------------------------------------------------------------------------
// The real WoS worker, wired up as a translator
// ---------------------------------------------------------------------------

/** The slice of worker global scope `wos-worker.ts` installs itself on. */
interface WorkerScopeStub {
  postMessage: (result: WosWorkerResult) => void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

let workerScope: WorkerScopeStub;
let workerOutput: WosWorkerResult[] = [];

/**
 * Runs `body` with the worker-scope stub installed as the global `self`.
 *
 * `wos-worker.ts` both *binds* its handler to `self` when the module evaluates
 * and *resolves* `self.postMessage` on every call, so the stub has to be in
 * place for the import and for every translation — but not in between, where
 * happy-dom's own `self` (the window) belongs.
 */
async function inWorkerScope<T>(body: () => T | Promise<T>): Promise<T> {
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: workerScope,
    configurable: true,
    writable: true,
  });
  try {
    return await body();
  } finally {
    if (originalSelf) {
      Object.defineProperty(globalThis, 'self', originalSelf);
    } else {
      delete (globalThis as { self?: unknown }).self;
    }
  }
}

beforeAll(async () => {
  workerScope = {
    postMessage: (result) => workerOutput.push(result),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  await inWorkerScope(() => import('@scripts/wos-worker'));
});

/**
 * Puts a raw socket payload through the real worker and returns what it posted,
 * or `null` for the event types the worker deliberately ignores.
 */
async function translateThroughWorker(raw: WosWorkerMessage): Promise<WosWorkerResult | null> {
  workerOutput = [];
  await inWorkerScope(() => { workerScope.onmessage!({ data: raw } as MessageEvent); });
  const posted = workerOutput[0];
  if (posted && posted.type !== 'wos_event') {
    throw new Error(`wos-worker rejected the payload: ${JSON.stringify(posted)}`);
  }
  return posted ?? null;
}

// ---------------------------------------------------------------------------
// The page the spectator writes into
// ---------------------------------------------------------------------------

/** Every element id `GameSpectator` reads or writes. */
const PAGE_ELEMENT_IDS = [
  'pb-record',
  'daily-pb-record',
  'daily-clear-record',
  'pb-value',
  'daily-pb-value',
  'daily-clear-value',
  'level-title',
  'level-value',
  'letters',
  'letters-label',
  'hidden-letter',
  'fake-letter',
  'correct-words-log',
  'wos-game-log',
  'twitch-chat-log',
] as const;

function buildPage(): void {
  document.body.replaceChildren();
  for (const id of PAGE_ELEMENT_IDS) {
    const element = document.createElement('div');
    element.id = id;
    document.body.appendChild(element);
  }
}

function text(id: string): string {
  return document.getElementById(id)!.innerText;
}

/** The words currently rendered in the found-words log, in rendered order. */
function foundWords(): string[] {
  return Array.from(
    document.getElementById('correct-words-log')!.querySelectorAll('.correct-word'),
  ).map((element) => element.textContent ?? '');
}

/** The length headings the found-words log renders, in rendered order. */
function wordGroupTitles(): string[] {
  return Array.from(
    document.getElementById('correct-words-log')!.querySelectorAll('.word-group__title'),
  ).map((element) => element.textContent ?? '');
}

/** The words rendered with the missed-word marker. */
function missedWords(): string[] {
  return Array.from(
    document.getElementById('correct-words-log')!.querySelectorAll('.missing-word'),
  ).map((element) => element.textContent ?? '');
}

function gameLog(): string {
  return text('wos-game-log');
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

let soundsPlayed: string[] = [];

class FakeAudio {
  constructor(readonly src: string = '') { }
  play(): Promise<void> {
    soundsPlayed.push(this.src);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Driving the spectator
// ---------------------------------------------------------------------------

interface StubWorker {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null;
}

let spectator: GameSpectator;
let spectatorWosWorker: StubWorker;
let spectatorTwitchWorker: StubWorker;

function workerNamed(fragment: string): StubWorker {
  const instances = (globalThis as unknown as { MockWorker: { instances: StubWorker[] } })
    .MockWorker.instances;
  const found = instances.find((instance) => instance.url.includes(fragment));
  if (!found) throw new Error(`No stub Worker was constructed for ${fragment}`);
  return found;
}

/**
 * Runs the fake clock forward, letting the (MSW-intercepted) fetches the
 * handler makes settle in between, until the handler's promise chain finishes.
 * Interleaving matters: the level-end path is timer → fetch → timer → fetch, so
 * a single `runAllTimersAsync()` would return before the later timers exist.
 */
async function drain(pending: Promise<unknown>): Promise<void> {
  let settled = false;
  const tracked = pending.then(
    () => { settled = true; },
    (error: unknown) => { settled = true; throw error as Error; },
  );
  for (let step = 0; step < 100 && !settled; step++) {
    await vi.advanceTimersByTimeAsync(250);
  }
  await tracked;
}

/** Play one WoS socket event all the way through to the page. */
async function playWosEvent(raw: WosWorkerMessage): Promise<void> {
  const translated = await translateThroughWorker(raw);
  if (!translated) return; // an event type the worker ignores
  const handler = spectatorWosWorker.onmessage as unknown as
    (event: MessageEvent) => Promise<void> | void;
  await drain(Promise.resolve(handler({ data: translated } as MessageEvent)));
}

/** Deliver a Twitch chat message the way the twitch worker does. */
function playChatMessage(username: string, message: string, timestamp: number): void {
  const handler = spectatorTwitchWorker.onmessage as unknown as
    (event: MessageEvent) => void;
  handler({ data: { type: 'twitch_message', username, message, timestamp } } as MessageEvent);
}

// ---------------------------------------------------------------------------
// Socket payload builders
// ---------------------------------------------------------------------------
//
// These follow the payload shapes documented in
// `tests/fixtures/wos-events/README.md`. Unguessed slots are built with '.'
// placeholders of the slot's length rather than an empty array: `saveBoard`
// rejects a slot whose letters contain '.', which is the strongest evidence in
// the repo for what WoS actually sends. See the note at the top of this file.

interface SlotPayload {
  letters: string[];
  word: string;
  user?: string;
  hitMax: boolean;
  index: number;
  length: number;
}

function emptySlots(lengths: number[]): SlotPayload[] {
  return lengths.map((length, index) => ({
    letters: Array.from({ length }, () => '.'),
    word: '',
    hitMax: false,
    index,
    length,
  }));
}

function levelStarted(options: {
  level: number;
  letters: string[];
  slotLengths: number[];
  language?: number;
}): WosWorkerMessage {
  return {
    eventType: 1,
    data: {
      level: options.level,
      letters: options.letters,
      slots: emptySlots(options.slotLengths),
      ...(options.language === undefined ? {} : { language: options.language }),
    },
  };
}

function correctGuess(options: {
  user: string;
  word: string;
  index: number;
  hitMax?: boolean;
}): WosWorkerMessage {
  return {
    eventType: 3,
    data: {
      user: { name: options.user },
      letters: options.word.split(''),
      index: options.index,
      hitMax: options.hitMax ?? false,
    },
  };
}

/**
 * A masked correct guess. A hidden guess masks **every** letter (maintainer-
 * confirmed, see the fixture README), so the length is all the event reveals.
 */
function maskedGuess(options: {
  user: string;
  length: number;
  index: number;
  hitMax?: boolean;
}): WosWorkerMessage {
  return {
    eventType: 3,
    data: {
      user: { name: options.user },
      letters: Array.from({ length: options.length }, () => '?'),
      index: options.index,
      hitMax: options.hitMax ?? false,
    },
  };
}

function levelResults(stars: number): WosWorkerMessage {
  return { eventType: 4, data: { stars } };
}

// ---------------------------------------------------------------------------
// Boards used by the scenarios
// ---------------------------------------------------------------------------

/** The level-3 CAUTION board, taken from `01-level-start.json`'s letters. */
const CAUTION_LETTERS = ['c', 'a', 'u', 't', 'i', 'o', 'n'];
/** Slot lengths chosen so the spec's "third slot" holds the 6-letter ACTION. */
const CAUTION_SLOT_LENGTHS = [4, 5, 6, 7];
/**
 * Every dictionary word that can be spelled from CAUTION, plus a 3-letter word
 * that must never be reported as missed (no slot on this board is that short).
 */
const CAUTION_DICTIONARY = ['coat', 'tonic', 'action', 'caution', 'auction', 'act'];

/** The level-19 TRILBY board from `specs/game-flow.md § Hidden and fake letters`. */
const TRILBY_LETTERS = ['t', 'l', 'r', 'i', 's', 'm', '?', 'b'];
const TRILBY_DICTIONARY = ['trilby', 'combat', 'limbs', 'brims', 'trims'];

/** A board whose anagram-rich letters give several equally plausible guesses. */
const BROOMED_LETTERS = ['b', 'r', 'o', 'o', 'd', 's', 'm', 'e'];
const BROOMED_DICTIONARY = ['broods', 'brooms', 'somber', 'bedroom'];

/** Serve `/api/words` so the real dictionary loads over the real HTTP path. */
function dictionaryContains(words: string[]) {
  return http.get('*/api/words', () => HttpResponse.json(words));
}

/** Reload the dictionary the spectator's word matching reads from. */
async function useDictionary(words: string[]): Promise<void> {
  server.use(dictionaryContains(words));
  vi.useRealTimers();
  await loadWordsFromDb();
  vi.useFakeTimers();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  buildPage();
  soundsPlayed = [];
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;

  // The dictionary load the constructor kicks off is fire-and-forget, so the
  // handler has to be in place before the spectator exists.
  server.use(dictionaryContains([]));

  spectator = new GameSpectator();
  spectatorWosWorker = workerNamed('wos-worker');
  spectatorTwitchWorker = workerNamed('twitch-chat-worker');

  await loadWordsFromDb();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  spectator.disconnect();
  spectator.disconnectTwitch();
});

// ===========================================================================
// specs/game-flow.md § Starting a level
// ===========================================================================

describe('specs/game-flow.md § Starting a level', () => {
  it('shows the level number, the letters and the board slots when a level starts', async () => {
    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));

    expect(text('level-title')).toBe('LEVEL');
    expect(text('level-value')).toBe('3');
    expect(text('letters-label')).toBe('Letters:');
    expect(text('letters')).toBe('C A U T I O N');
    expect(gameLog()).toContain('Level 3 Started');
    // The board's empty slots are taken up, ready to be filled.
    expect(spectator.currentLevelSlots).toHaveLength(4);
    expect(spectator.currentLevelSlots.every((slot) => !slot.user)).toBe(true);
  });

  it('clears everything from the previous level when the next one starts', async () => {
    await useDictionary(CAUTION_DICTIONARY);

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    playChatMessage('clarkio', 'coat', 1_000);
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3, hitMax: true }));

    // Everything the previous level put on screen is present…
    expect(foundWords()).toContain('CAUTION');
    expect(text('letters-label')).toBe('Big Word:');
    expect(spectator.twitchChatLog.size).toBe(1);

    // …and gone once the next level starts.
    await playWosEvent(levelStarted({
      level: 4,
      letters: TRILBY_LETTERS,
      slotLengths: [4, 6],
    }));

    expect(foundWords()).toEqual([]);
    expect(text('letters-label')).toBe('Letters:');
    expect(text('hidden-letter')).toBe('');
    expect(text('fake-letter')).toBe('');
    expect(spectator.currentLevelBigWord).toBe('');
    expect(spectator.twitchChatLog.size).toBe(0);
  });

  it('adopts a level already under way without clearing what is on screen', async () => {
    await useDictionary(CAUTION_DICTIONARY);

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    // `12-game-connected.json` is the "joined a game in progress" event.
    await playWosEvent(gameConnectedFixture as WosWorkerMessage);

    expect(text('level-value')).toBe('7');
    expect(gameLog()).toContain('Level 7 In Progress');
    expect(gameLog()).not.toContain('Level 7 Started');
    // The slots of the level in progress are adopted…
    expect(spectator.currentLevelSlots).toHaveLength(3);
    expect(spectator.currentLevelSlots[0].user).toBe('biocow');
    // …and nothing already on screen was cleared.
    expect(foundWords()).toEqual(['COAT']);
  });

  it('notices the language the game is being played in', async () => {
    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
      language: 4,
    }));

    expect(gameLog()).toContain('Game language: fr');
    expect(spectator.currentLanguageCode).toBe('fr');
  });

  it('keeps the language it already knows when a later event carries none', async () => {
    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
      language: 4,
    }));

    // An unrecognised id, then no id at all.
    await playWosEvent(levelStarted({
      level: 4,
      letters: CAUTION_LETTERS,
      slotLengths: [4],
      language: 99,
    }));
    await playWosEvent(levelStarted({ level: 5, letters: CAUTION_LETTERS, slotLengths: [4] }));

    expect(spectator.currentLanguageCode).toBe('fr');
  });
});

// ===========================================================================
// specs/game-flow.md § A correct guess
// ===========================================================================

describe('specs/game-flow.md § A correct guess', () => {
  beforeEach(async () => {
    await useDictionary(CAUTION_DICTIONARY);
    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
  });

  it('puts the guessed word in the right slot, credited to the player who found it', async () => {
    // The spec's own example: clarkio guesses ACTION into the third slot.
    await playWosEvent(correctGuess({ user: 'Clarkio', word: 'action', index: 2 }));

    expect(foundWords()).toContain('ACTION');
    expect(gameLog()).toContain('clarkio correctly guessed: action');

    const thirdSlot = spectator.currentLevelSlots[2];
    expect(thirdSlot.word).toBe('action');
    expect(thirdSlot.user).toBe('clarkio');
    expect(thirdSlot.length).toBe(6);

    // No other slot was touched.
    expect(spectator.currentLevelSlots.filter((slot) => slot.user)).toHaveLength(1);
  });

  it('orders the found words by length and then alphabetically', async () => {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3 }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'tonic', index: 1 }));
    await playWosEvent(correctGuess({ user: 'smc_may_i', word: 'action', index: 2 }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    expect(wordGroupTitles()).toEqual(['4:', '5:', '6:', '7:']);
    expect(foundWords()).toEqual(['COAT', 'TONIC', 'ACTION', 'CAUTION']);
  });

  it('groups words of the same length in alphabetical order', async () => {
    // AUCTION and CAUTION are anagrams, so only the alphabetical rule separates them.
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3 }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'auction', index: 3 }));

    expect(foundWords()).toEqual(['AUCTION', 'CAUTION']);
    expect(wordGroupTitles()).toEqual(['7:']);
  });

  it('turns the letters display into the big word when the big word is guessed', async () => {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3, hitMax: true }));

    expect(text('letters-label')).toBe('Big Word:');
    expect(text('letters')).toBe('C A U T I O N');
    expect(spectator.currentLevelSlots[3].hitMax).toBe(true);
  });

  it('trusts the word the game gave it and never looks at chat', async () => {
    // Chat is full of a different word of the same length. An unmasked event
    // carries the word itself, so chat must not get a vote.
    playChatMessage('clarkio', 'tonic', 1_000);

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'action', index: 2 }));

    expect(foundWords()).toEqual(['ACTION']);
    // The chat message is untouched and still available to a later masked guess.
    expect(spectator.twitchChatLog.get('clarkio')).toEqual([
      { message: 'tonic', timestamp: 1_000, consumed: false },
    ]);
  });

  it('shows a guess for a slot the board does not have, but fills no slot', async () => {
    // ❓ Unconfirmed — `specs/game-flow.md § Open questions for the maintainer`
    // flags that the found-words list and the board disagree here. This pins
    // current behaviour; it is not an endorsement of it.
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 99 }));

    expect(foundWords()).toEqual(['COAT']);
    expect(spectator.currentLevelSlots.every((slot) => !slot.user)).toBe(true);
  });
});
