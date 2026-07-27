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
import correctGuessHiddenFixture from '../fixtures/wos-events/03-correct-guess-hidden.json';
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
 * Installs the worker-scope stub as the global `self`; returns the undo.
 *
 * `wos-worker.ts` both *binds* its handler to `self` when the module evaluates
 * and *resolves* `self.postMessage` on every call, so the stub has to be in
 * place for the import and for every translation — but not in between, where
 * happy-dom's own `self` (the window) belongs.
 */
function installWorkerScope(): () => void {
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: workerScope,
    configurable: true,
    writable: true,
  });
  return () => {
    if (originalSelf) {
      Object.defineProperty(globalThis, 'self', originalSelf);
    } else {
      delete (globalThis as { self?: unknown }).self;
    }
  };
}

beforeAll(async () => {
  workerScope = {
    postMessage: (result) => workerOutput.push(result),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  const restoreSelf = installWorkerScope();
  try {
    await import('@scripts/wos-worker');
  } finally {
    restoreSelf();
  }
});

/**
 * Puts a raw socket payload through the real worker and returns what it posted,
 * or `null` for the event types the worker deliberately ignores.
 */
function translateThroughWorker(raw: WosWorkerMessage): WosWorkerResult | null {
  workerOutput = [];
  const restoreSelf = installWorkerScope();
  try {
    workerScope.onmessage!({ data: raw } as MessageEvent);
  } finally {
    restoreSelf();
  }
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

/**
 * Hand one WoS socket event to the spectator without waiting for it. Used to
 * put two events in flight at once, which is what the level-end grace period
 * exists to survive.
 */
function startWosEvent(raw: WosWorkerMessage): Promise<unknown> {
  const translated = translateThroughWorker(raw);
  if (!translated) return Promise.resolve(); // an event type the worker ignores
  const handler = spectatorWosWorker.onmessage as unknown as
    (event: MessageEvent) => Promise<void> | void;
  return Promise.resolve(handler({ data: translated } as MessageEvent));
}

/** Play one WoS socket event all the way through to the page. */
async function playWosEvent(raw: WosWorkerMessage): Promise<void> {
  await drain(startWosEvent(raw));
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
      // A fresh array per event, as a socket payload always is. This matters:
      // `handleGameInitialization` keeps the array it is handed by reference and
      // the hidden-letter deduction writes into it, so sharing one array between
      // events would let one level's discoveries leak into the next.
      letters: [...options.letters],
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

/** The archive has never seen this board. */
function boardNotArchived() {
  return http.get('*/api/boards/:id', () => HttpResponse.json({ error: 'Not found' }, { status: 404 }));
}

/** The archive holds a complete capture of this board. */
function boardArchived(id: string, words: string[]) {
  return http.get('*/api/boards/:id', () => HttpResponse.json({
    id,
    created_at: '2025-01-01T00:00:00.000Z',
    slots: words.map((word, index) => ({
      letters: word.split(''),
      word,
      user: 'someone',
      hitMax: index === words.length - 1,
    })),
  }));
}

/** Accepts a board capture and records the body the app actually sent. */
function boardCaptureRecorder(): { posted: Record<string, unknown>[]; handler: ReturnType<typeof http.post> } {
  const posted: Record<string, unknown>[] = [];
  const handler = http.post('*/api/boards', async ({ request }) => {
    posted.push(await request.json() as Record<string, unknown>);
    return HttpResponse.json({ id: 'saved' }, { status: 201 });
  });
  return { posted, handler };
}

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

// ===========================================================================
// specs/game-flow.md § Hidden and fake letters
// ===========================================================================

describe('specs/game-flow.md § Hidden and fake letters', () => {
  beforeEach(async () => {
    await useDictionary(TRILBY_DICTIONARY);
    spectator.isSoundsEnabled = false;
  });

  it('deduces a hidden letter from a guess and puts it where the mask was', async () => {
    // The spec's own example: letters T L R I S M ? B, and someone guesses TRILBY.
    await playWosEvent(levelStarted({ level: 5, letters: TRILBY_LETTERS, slotLengths: [6, 5] }));

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'trilby', index: 0 }));

    expect(text('hidden-letter')).toBe('Y');
    expect(text('letters')).toBe('T L R I S M Y B');
  });

  it('shows a hidden letter once even when a later guess implies it again', async () => {
    await playWosEvent(levelStarted({ level: 5, letters: TRILBY_LETTERS, slotLengths: [6, 5] }));

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'trilby', index: 0 }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'misty', index: 1 }));

    expect(text('hidden-letter')).toBe('Y');
    expect(text('letters')).toBe('T L R I S M Y B');
  });

  it('adds a second hidden letter found later rather than replacing the first', async () => {
    // As the spec's board, but with a second masked tile.
    await playWosEvent(levelStarted({
      level: 5,
      letters: ['t', 'l', 'r', 'i', 's', 'm', '?', 'b', '?'],
      slotLengths: [6, 5],
    }));

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'trilby', index: 0 }));
    expect(text('hidden-letter')).toBe('Y');

    // MISTS needs a second S, which the board only has behind the other mask.
    await playWosEvent(correctGuess({ user: 'biocow', word: 'mists', index: 1 }));

    expect(text('hidden-letter')).toBe('Y S');
    expect(text('letters')).toBe('T L R I S M Y B S');
  });

  it('works out the hidden and fake letters when the big word is guessed', async () => {
    await playWosEvent(levelStarted({
      level: 5,
      letters: ['b', 'r', 'o', 'o', 'd', 'm', '?', 'x'],
      slotLengths: [7],
    }));

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'broomed', index: 0, hitMax: true }));

    expect(text('letters-label')).toBe('Big Word:');
    expect(text('letters')).toBe('B R O O M E D');
    expect(text('hidden-letter')).toBe('E');
    expect(text('fake-letter')).toBe('X');
  });

  it('works the hidden letters out once across a level with several big words', async () => {
    // BROOMED, BEDROOM and BOREDOM are anagrams; each one fires the big-word
    // path, and re-running the deduction must not add duplicates.
    await playWosEvent(levelStarted({
      level: 5,
      letters: ['b', 'r', 'o', 'o', 'd', 'm', '?'],
      slotLengths: [7, 7, 7],
    }));

    await playWosEvent(correctGuess({ user: 'clarkio', word: 'broomed', index: 0, hitMax: true }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'bedroom', index: 1, hitMax: true }));
    await playWosEvent(correctGuess({ user: 'smc_may_i', word: 'boredom', index: 2, hitMax: true }));

    expect(text('hidden-letter')).toBe('E');
    expect(spectator.currentLevelHiddenLetters).toEqual(['e']);
  });

  it('drops the fake letters and fills each mask once when the game reveals them', async () => {
    // `10-letters-revealed.json` reveals hidden A and fake X and Z. The board
    // below has two masks but only one letter to fill them with — the spare
    // mask is dropped rather than left to stand for a tile that never existed
    // (issue #85).
    await playWosEvent(levelStarted({
      level: 5,
      letters: ['t', 'r', '?', 'x', 'z', '?'],
      slotLengths: [4],
    }));

    await playWosEvent(lettersRevealedFixture as WosWorkerMessage);

    expect(text('hidden-letter')).toBe('A');
    expect(text('fake-letter')).toBe('X Z');
    expect(text('letters')).toBe('T R A');
    expect(spectator.currentLevelLetters).toEqual(['t', 'r', 'a']);
  });

  it('leaves the letters alone when the reveal arrives after the big word', async () => {
    await playWosEvent(levelStarted({
      level: 5,
      letters: ['t', 'r', 'a', 'x', 'z', 'p'],
      slotLengths: [4],
    }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'trap', index: 0, hitMax: true }));

    await playWosEvent(lettersRevealedFixture as WosWorkerMessage);

    // The revealed letters are shown…
    expect(text('hidden-letter')).toBe('A');
    expect(text('fake-letter')).toBe('X Z');
    // …but the board's letters are already known from the big word.
    expect(text('letters')).toBe('T R A P');
    expect(spectator.currentLevelLetters).toEqual(['t', 'r', 'a', 'x', 'z', 'p']);
  });
});

// ===========================================================================
// specs/game-flow.md § Masked guesses
// ===========================================================================
//
// The most bug-prone path in the codebase. From level 19 the game stops saying
// which word was guessed and reports only the player and the length, and WoS+
// reconstructs the word from that player's recent chat.

describe('specs/game-flow.md § Masked guesses', () => {
  /** Start the TRILBY board from the spec, whose seventh tile is still masked. */
  async function startTrilbyLevel(slotLengths = [6, 5]): Promise<void> {
    await playWosEvent(levelStarted({ level: 19, letters: TRILBY_LETTERS, slotLengths }));
  }

  beforeEach(async () => {
    await useDictionary(TRILBY_DICTIONARY);
    spectator.isSoundsEnabled = false;
  });

  it('recovers the word from what the player typed in chat', async () => {
    await startTrilbyLevel();
    playChatMessage('clarkio', 'trilby', 1_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(foundWords()).toEqual(['TRILBY']);
    expect(spectator.currentLevelSlots[0]).toMatchObject({
      word: 'trilby',
      user: 'clarkio',
    });
    expect(gameLog()).toContain('clarkio correctly guessed: trilby');
    // The message is shown in the chat log as it arrives, too.
    expect(text('twitch-chat-log')).toContain('[Twitch Chat] clarkio: trilby');
  });

  it('prefers a real word over a same-length string that is not one', async () => {
    await startTrilbyLevel();
    playChatMessage('clarkio', 'trilby', 1_000);
    // Typed later, and exactly the right length, but not a word.
    playChatMessage('clarkio', 'zzzzzz', 2_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(foundWords()).toEqual(['TRILBY']);
  });

  it('lets a still-masked tile stand for whichever letter the word needs', async () => {
    await startTrilbyLevel();
    // TRILBY needs a Y, which the board only has behind the '?' tile.
    playChatMessage('clarkio', 'trilby', 1_000);
    // COMBAT is a real word of the same length typed more recently, but it
    // cannot be built from these tiles even with the mask standing in.
    playChatMessage('clarkio', 'combat', 2_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(foundWords()).toEqual(['TRILBY']);
  });

  it('chooses the most recently typed of several words that all fit', async () => {
    await useDictionary(BROOMED_DICTIONARY);
    await playWosEvent(levelStarted({ level: 19, letters: BROOMED_LETTERS, slotLengths: [6, 6] }));
    playChatMessage('clarkio', 'broods', 1_000);
    playChatMessage('clarkio', 'brooms', 2_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(foundWords()).toEqual(['BROOMS']);
  });

  it('resolves two masked guesses from one player to two different words', async () => {
    await useDictionary(BROOMED_DICTIONARY);
    await playWosEvent(levelStarted({ level: 19, letters: BROOMED_LETTERS, slotLengths: [6, 6] }));
    playChatMessage('clarkio', 'broods', 1_000);
    playChatMessage('clarkio', 'brooms', 2_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));
    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 1 }));

    // A message used for one guess is never reused for another.
    expect(foundWords().sort()).toEqual(['BROODS', 'BROOMS']);
    const words = spectator.currentLevelSlots.map((slot) => slot.word);
    expect([...words].sort()).toEqual(['broods', 'brooms']);
  });

  it('resolves two masked guesses that arrive at the same moment', async () => {
    // Issue #96: rapid or near-simultaneous guesses used to knock each other
    // out, because resolution read a single "latest message" that the second
    // guess had already overwritten by the time the first (delayed) handler ran.
    await useDictionary(BROOMED_DICTIONARY);
    await playWosEvent(levelStarted({ level: 19, letters: BROOMED_LETTERS, slotLengths: [6, 6] }));
    playChatMessage('clarkio', 'broods', 1_000);
    playChatMessage('clarkio', 'brooms', 2_000);

    // Both events are in flight before either has been applied.
    const first = startWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));
    const second = startWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 1 }));
    await drain(Promise.all([first, second]));

    expect([...foundWords()].sort()).toEqual(['BROODS', 'BROOMS']);
    expect(spectator.currentLevelSlots.map((slot) => slot.word).sort())
      .toEqual(['broods', 'brooms']);
  });

  it('recovers a masked big word from chat', async () => {
    // `03-correct-guess-hidden.json` is a hidden correct guess with hitMax set:
    // every letter is masked, so only the length and the player are known.
    await useDictionary(CAUTION_DICTIONARY);
    await playWosEvent(levelStarted({
      level: 19,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    playChatMessage('clarkio', 'caution', 1_000);

    await playWosEvent(correctGuessHiddenFixture as WosWorkerMessage);

    expect(foundWords()).toEqual(['CAUTION']);
    expect(text('letters-label')).toBe('Big Word:');
    expect(text('letters')).toBe('C A U T I O N');
    expect(spectator.currentLevelSlots[3]).toMatchObject({
      word: 'caution',
      user: 'clarkio',
      hitMax: true,
    });
  });

  it('does not choose a word that is already on the board', async () => {
    await useDictionary(CAUTION_DICTIONARY);
    await playWosEvent(levelStarted({
      level: 19,
      letters: CAUTION_LETTERS,
      slotLengths: [6, 6, 7],
    }));
    // ACTION is already in a slot, reported plainly by the game.
    await playWosEvent(correctGuess({ user: 'biocow', word: 'action', index: 0 }));
    // …and clarkio types it again.
    playChatMessage('clarkio', 'action', 2_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 1 }));

    // The game does not accept a word already on the board, so this is not it.
    expect(foundWords()).toEqual(['ACTION']);
    expect(spectator.currentLevelSlots[1].user).toBeUndefined();
    expect(spectator.currentLevelSlots[1].word).toBe('');
  });

  it('leaves the slot empty and says so when no chat message can be the word', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    await startTrilbyLevel();
    // Nothing of the right length.
    playChatMessage('clarkio', 'brims', 1_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(foundWords()).toEqual([]);
    expect(spectator.currentLevelSlots[0].user).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'Could not find matching message for clarkio',
    );
    warn.mockRestore();
  });

  it('considers only the 25 most recent messages a player typed', async () => {
    await startTrilbyLevel();
    // The word actually guessed, then 25 newer same-length messages that push
    // it out of the history.
    playChatMessage('clarkio', 'trilby', 1_000);
    for (let index = 0; index < 25; index++) {
      playChatMessage('clarkio', `qqqqq${String.fromCharCode(97 + index)}`, 2_000 + index);
    }

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(spectator.twitchChatLog.get('clarkio')).toHaveLength(25);
    expect(foundWords()).not.toContain('TRILBY');
    // Falls back to the most recent same-length message it still has.
    expect(spectator.currentLevelSlots[0].word).toBe('qqqqqy');
  });

  it('resolves a masked guess at any level — no level threshold is enforced', async () => {
    // ❓ Unconfirmed — `specs/game-flow.md § Masked guesses` flags that the code
    // comments say masking begins at level 19 while `copilot-instructions.md`
    // says level 20. Neither number is in the code: `updateGameState` branches
    // only on the word containing '?', and never reads `currentLevel`. So a
    // masked event at level 3 is resolved from chat exactly like one at level
    // 19. This test pins that, and is the honest answer while the two documents
    // disagree — it is not a vote for either threshold.
    await useDictionary(CAUTION_DICTIONARY);
    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [6] }));
    playChatMessage('clarkio', 'action', 1_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));

    expect(spectator.currentLevel).toBe(3);
    expect(foundWords()).toEqual(['ACTION']);
  });

  it('treats a slot filled by an unrecoverable masked guess as never filled (❓ unconfirmed)', async () => {
    // ❓ Unconfirmed — `specs/game-flow.md § Open questions for the maintainer`
    // records this as current behaviour awaiting a decision: a player really did
    // find that word, but WoS+ cannot name it, so the level does not count as a
    // clear. Recording the slot as filled with an unknown word would keep clear
    // detection honest but would mean capturing a board with a blank word, which
    // is refused elsewhere. Pinned, not endorsed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    spectator.isSoundsEnabled = true;
    await startTrilbyLevel([6, 5]);
    playChatMessage('clarkio', 'trilby', 1_000);

    await playWosEvent(maskedGuess({ user: 'clarkio', length: 6, index: 0 }));
    // A second player's guess arrives masked with nothing in chat to match.
    await playWosEvent(maskedGuess({ user: 'biocow', length: 5, index: 1 }));

    await playWosEvent(levelResults(2));

    // Both slots were genuinely filled by players, but the level is not a clear
    // and no board is captured (no POST handler is registered, so an attempted
    // capture would fail this test).
    expect(soundsPlayed).not.toContain('/assets/clear.mp3');
    expect(spectator.currentLevelSlots[1].user).toBeUndefined();
    warn.mockRestore();
  });

  it.todo(
    'a masked guess of 13+ letters can never be recovered — ❓ unconfirmed, and ' +
    'the 4-to-12-letter chat filter that causes it lives in twitch-chat-worker.ts, ' +
    'so it belongs with that module rather than with GameSpectator',
  );
});

// ===========================================================================
// specs/game-flow.md § Ending a level — the words nobody found
// ===========================================================================

describe('specs/game-flow.md § Ending a level (missed words)', () => {
  beforeEach(async () => {
    await useDictionary(CAUTION_DICTIONARY);
    spectator.isSoundsEnabled = false;
    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
  });

  it('marks the words nobody found with a star and leaves the found ones plain', async () => {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(levelResults(2));

    // COAT was found; everything else spellable from CAUTION was missed.
    expect(missedWords()).toEqual(['TONIC*', 'ACTION*', 'AUCTION*', 'CAUTION*']);
    expect(foundWords()).toEqual(['COAT', 'TONIC*', 'ACTION*', 'AUCTION*', 'CAUTION*']);
    // ACT is a real word spellable from these letters, but no slot on this
    // board is three letters long, so it was never a word anyone could find.
    expect(foundWords().join(' ')).not.toContain('ACT*');
  });

  it('summarises the missed words by length, shortest first', async () => {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(levelResults(2));

    const log = gameLog();
    expect(log).toContain('Total Empty Slots: 3');
    const positions = ['5', '6', '7'].map((length) => {
      const line = `Missed 1: ${length} letter words`;
      expect(log).toContain(line);
      return log.indexOf(line);
    });
    // Shortest first.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Nothing was missed at the four-letter length — COAT was found.
    expect(log).not.toContain('4 letter words');
  });

  it('does not report a word a second time when the level-end run happens again', async () => {
    // Regression: a word already displayed as missed carries a trailing '*'.
    // Before the fix that marker made it fail to match itself, so every later
    // run of the level-end pipeline reported it as missed all over again.
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(levelResults(2));
    const afterResults = foundWords();

    // The game then ends, which runs the missed-word calculation a second time.
    await playWosEvent(gameEndedFixture as WosWorkerMessage);

    expect(foundWords()).toEqual(afterResults);
    for (const word of ['TONIC*', 'ACTION*', 'AUCTION*', 'CAUTION*']) {
      expect(foundWords().filter((rendered) => rendered === word)).toHaveLength(1);
    }
  });

  it('uses the archived board to name the missed words when the board is known', async () => {
    server.use(boardArchived('CAUTION', ['coat', 'tonic', 'action', 'caution']));

    // The big word is guessed, so WoS+ knows which board this is.
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3, hitMax: true }));

    await playWosEvent(levelResults(2));

    // Exactly the two slots nobody filled, taken from the archived board —
    // not the wider dictionary sweep.
    expect(missedWords()).toEqual(['TONIC*', 'ACTION*']);
  });

  it('reports the missed words and the level reached when the game ends', async () => {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(gameEndedFixture as WosWorkerMessage);

    expect(gameLog()).toContain('Game Ended on Level 3');
    expect(missedWords()).toEqual(['TONIC*', 'ACTION*', 'AUCTION*', 'CAUTION*']);
  });

  it.todo(
    'sorts a missed word after an identical found word — not reachable from the ' +
    'event stream, because the missed-word calculation excludes every word ' +
    'already found; only a duplicate could show it, and duplicates are the bug',
  );
});

// ===========================================================================
// specs/game-flow.md § Ending a level — stars, clears and capture
// ===========================================================================

describe('specs/game-flow.md § Ending a level', () => {
  beforeEach(async () => {
    await useDictionary(CAUTION_DICTIONARY);
  });

  /** Fill every slot on the CAUTION board, big word last. */
  async function clearTheBoard(): Promise<void> {
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'tonic', index: 1 }));
    await playWosEvent(correctGuess({ user: 'smc_may_i', word: 'action', index: 2 }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'caution', index: 3, hitMax: true }));
  }

  it('advances the level shown by the stars earned', async () => {
    spectator.isSoundsEnabled = false;
    await playWosEvent(levelStarted({ level: 12, letters: CAUTION_LETTERS, slotLengths: [4] }));

    await playWosEvent(levelResults(3));

    expect(text('level-value')).toBe('15');
    expect(text('level-title')).toBe('NEXT LEVEL');
    expect(gameLog()).toContain('Level 12 ended with 3 stars');
  });

  it('captures the board and plays the clear sound when every slot was filled', async () => {
    const capture = boardCaptureRecorder();
    server.use(boardNotArchived(), capture.handler);

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    await clearTheBoard();

    // Two stars, but every slot has a player against it — that is a clear.
    await playWosEvent(levelResults(2));

    expect(capture.posted).toHaveLength(1);
    expect(capture.posted[0]).toMatchObject({
      id: 'CAUTION',
      language_code: 'en',
    });
    expect(capture.posted[0].slots).toMatchObject([
      { word: 'coat', user: 'clarkio' },
      { word: 'tonic', user: 'biocow' },
      { word: 'action', user: 'smc_may_i' },
      { word: 'caution', user: 'clarkio', hitMax: true },
    ]);
    expect(soundsPlayed).toEqual(['/assets/clear.mp3']);
    // A cleared board has nothing to report as missed.
    expect(missedWords()).toEqual([]);
  });

  it('records the game language on the board it captures', async () => {
    const capture = boardCaptureRecorder();
    server.use(boardNotArchived(), capture.handler);

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
      language: 4,
    }));
    await clearTheBoard();
    await playWosEvent(levelResults(5));

    expect(capture.posted[0]).toMatchObject({ language_code: 'fr' });
  });

  it('treats five stars as a clear even with a slot nobody filled', async () => {
    server.use(boardNotArchived());

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(levelResults(5));

    expect(soundsPlayed).toEqual(['/assets/clear.mp3']);
    // Nothing is reported as missed on a clear, and no board is captured
    // because the slots are incomplete (no POST handler is registered, so a
    // capture attempt would fail this test).
    expect(missedWords()).toEqual([]);
  });

  it('plays the near-miss sound for one star and the decent-effort sound for three', async () => {
    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [4] }));

    await playWosEvent(levelResults(1));
    expect(soundsPlayed).toEqual(['/assets/ooo_close_one.wav']);

    soundsPlayed = [];
    await playWosEvent(levelResults(3));
    expect(soundsPlayed).toEqual(['/assets/not_too_shabby.wav']);
  });

  it('plays the end-of-game sound when the run comes to an end', async () => {
    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [4] }));

    await playWosEvent(gameEndedFixture as WosWorkerMessage);

    expect(soundsPlayed).toEqual(['/assets/loser.wav']);
  });

  it('counts a guess accepted in the final instant of the level', async () => {
    const capture = boardCaptureRecorder();
    server.use(boardNotArchived(), capture.handler);

    await playWosEvent(levelStarted({
      level: 3,
      letters: CAUTION_LETTERS,
      slotLengths: CAUTION_SLOT_LENGTHS,
    }));
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));
    await playWosEvent(correctGuess({ user: 'biocow', word: 'tonic', index: 1 }));
    await playWosEvent(correctGuess({ user: 'smc_may_i', word: 'action', index: 2 }));

    // The last guess and the level ending are in flight at the same time.
    const buzzerBeater = startWosEvent(
      correctGuess({ user: 'clarkio', word: 'caution', index: 3, hitMax: true }),
    );
    const ending = startWosEvent(levelResults(4));
    await drain(Promise.all([buzzerBeater, ending]));

    // The buzzer-beater completed the board, so the level counts as a clear
    // and the board is captured with that last word in it.
    expect(soundsPlayed).toEqual(['/assets/clear.mp3']);
    expect(capture.posted).toHaveLength(1);
    expect(capture.posted[0].slots).toMatchObject([
      { word: 'coat' }, { word: 'tonic' }, { word: 'action' }, { word: 'caution' },
    ]);
  });

  it('refreshes the channel records after a level, and never lowers a number', async () => {
    server.use(http.get('*/api/channel-stats/:channel', () => HttpResponse.json({
      allTimePersonalBest: 30,
      dailyBest: 5,
      dailyClears: 2,
      chatbotEnabled: true,
    })));

    spectator.isSoundsEnabled = false;
    // The channel WoS+ is following, as `connectToTwitch` would have set it.
    spectator.currentChannel = 'clarkio';
    // WoS+ has already seen a higher all-time best than the chatbot has written.
    spectator.personalBest = 42;

    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [4] }));
    await playWosEvent(levelResults(2));

    expect(text('pb-value')).toBe('42');
    expect(text('daily-pb-value')).toBe('5');
    expect(text('daily-clear-value')).toBe('2');
  });

  it('plays nothing when the viewer has turned sounds off', async () => {
    spectator.isSoundsEnabled = false;
    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [4] }));

    await playWosEvent(levelResults(1));
    await playWosEvent(gameEndedFixture as WosWorkerMessage);

    expect(soundsPlayed).toEqual([]);
  });

  it('plays nothing, and queues nothing, while the view is in a background tab', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await playWosEvent(levelStarted({ level: 3, letters: CAUTION_LETTERS, slotLengths: [4] }));

    await playWosEvent(levelResults(1));
    await playWosEvent(levelResults(3));
    expect(soundsPlayed).toEqual([]);

    // Coming back to the foreground must not release a backlog.
    hidden.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(soundsPlayed).toEqual([]);
    hidden.mockRestore();
  });

  it('reports missed words of length zero when a slot carries no letters (❓ unconfirmed)', async () => {
    // ❓ Unconfirmed — `tests/fixtures/wos-events/README.md` marks the slot
    // element shape as INFERRED. Everywhere else this file builds an unguessed
    // slot as a '.'-placeholder of the slot's length, which is what
    // `saveBoard`'s "letters.includes('.')" check implies WoS really sends.
    //
    // This test uses `01-level-start.json` verbatim, where unguessed slots have
    // `letters: []`, and pins what that shape produces: the missed-word minimum
    // length collapses to 0 (so words shorter than any slot are reported) and
    // the end-of-level summary counts every missed word as "0 letter words".
    //
    // If WoS really does send empty letter arrays, both of those are defects in
    // `logMissingWords`/`logEmptySlots`, which read `slot.letters.length` rather
    // than the `slot.length` the payload also carries. Maintainer to confirm the
    // wire shape before either is changed — this test is a description of
    // current behaviour, not an endorsement of it.
    spectator.isSoundsEnabled = false;
    await playWosEvent(levelStartFixture as WosWorkerMessage);
    await playWosEvent(correctGuess({ user: 'clarkio', word: 'coat', index: 0 }));

    await playWosEvent(levelResults(2));

    // ACT is three letters; no slot on this board is.
    expect(missedWords()).toContain('ACT*');
    expect(gameLog()).toContain('Missed 3: 0 letter words');
  });
});
