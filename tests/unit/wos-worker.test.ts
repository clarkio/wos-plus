import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WosWorkerMessage, WosWorkerResult } from '@scripts/wos-worker';

import levelStart from '../fixtures/wos-events/01-level-start.json';
import unknown02 from '../fixtures/wos-events/02-unknown-unhandled.json';
import correctGuess from '../fixtures/wos-events/03-correct-guess.json';
import correctGuessHidden from '../fixtures/wos-events/03-correct-guess-hidden.json';
import levelResults from '../fixtures/wos-events/04-level-results.json';
import gameEnded from '../fixtures/wos-events/05-game-ended.json';
import unknown06 from '../fixtures/wos-events/06-unknown-unhandled.json';
import lettersCycled from '../fixtures/wos-events/07-letters-cycled.json';
import levelEnded from '../fixtures/wos-events/08-level-ended.json';
import unknown09 from '../fixtures/wos-events/09-unknown-unhandled.json';
import lettersRevealed from '../fixtures/wos-events/10-letters-revealed.json';
import guessingUnlocked from '../fixtures/wos-events/11-guessing-unlocked.json';
import gameConnected from '../fixtures/wos-events/12-game-connected.json';

/**
 * Unit tests for src/scripts/wos-worker.ts — the Web Worker that turns raw WoS
 * socket events into the `wos_event` messages `GameSpectator` consumes.
 *
 * The worker runs in worker scope: it installs its handlers on `self`, not on
 * `window`, and it never touches the DOM. So instead of spawning a real
 * `Worker` (which vitest's setup file stubs out anyway) these tests install a
 * minimal worker-scope stub on `globalThis.self`, import the module so it binds
 * its handlers to that stub, and then drive `self.onmessage` directly and
 * assert on `self.postMessage`.
 *
 * Fixtures live in tests/fixtures/wos-events/ — see the README there for which
 * payload fields are known protocol and which are inferred.
 */

/** The subset of `WorkerGlobalScope` that wos-worker.ts actually uses. */
interface WorkerScopeStub {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

let scope: WorkerScopeStub;
let originalSelf: PropertyDescriptor | undefined;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

/** Fresh worker scope + a fresh module instance (the worker holds module state). */
async function loadWorkerWithFreshScope(): Promise<void> {
  scope = {
    postMessage: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };

  Object.defineProperty(globalThis, 'self', {
    value: scope,
    configurable: true,
    writable: true,
  });

  vi.resetModules();
  await import('@scripts/wos-worker');
}

/** Deliver a message to the worker exactly as the runtime would. */
function send(message: unknown): void {
  scope.onmessage!({ data: message } as MessageEvent);
}

/** The single result the worker posted (fails if it posted zero or many). */
function postedResult(): WosWorkerResult {
  expect(scope.postMessage).toHaveBeenCalledTimes(1);
  return scope.postMessage.mock.calls[0][0] as WosWorkerResult;
}

beforeEach(async () => {
  vi.clearAllMocks();
  originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  // The worker console.logs unhandled event types; keep the run quiet but
  // assertable.
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
  await loadWorkerWithFreshScope();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  if (originalSelf) {
    Object.defineProperty(globalThis, 'self', originalSelf);
  } else {
    delete (globalThis as Record<string, unknown>).self;
  }
});

/**
 * One row per WoS event type number, 1 through 12.
 *
 * `expectedName` is the `wosEventName` the worker labels the event with, or
 * `null` for the numbers the worker has no branch for — those must produce no
 * postMessage at all. `expected` is asserted as a subset of the posted payload;
 * three representative rows are additionally asserted whole further down.
 */
interface EventRow {
  eventType: number;
  fixture: string;
  message: WosWorkerMessage;
  expectedName: string | null;
  expected?: Partial<WosWorkerResult>;
}

const eventTable: EventRow[] = [
  {
    eventType: 1,
    fixture: '01-level-start.json',
    message: levelStart,
    expectedName: 'Level Started',
    expected: {
      level: 3,
      letters: ['c', 'a', 'u', 't', 'i', 'o', 'n'],
      slots: levelStart.data.slots,
      username: '',
      stars: 0,
      hitMax: false,
    },
  },
  {
    eventType: 2,
    fixture: '02-unknown-unhandled.json',
    message: unknown02,
    expectedName: null, // no branch in wos-worker.ts; meaning unknown
  },
  {
    eventType: 3,
    fixture: '03-correct-guess.json',
    message: correctGuess,
    expectedName: 'Correct Guess',
    expected: {
      username: 'smc_may_i', // lowercased by the worker
      letters: ['c', 'o', 'a', 't'],
      index: 2,
      hitMax: false,
    },
  },
  {
    eventType: 3,
    fixture: '03-correct-guess-hidden.json',
    message: correctGuessHidden,
    expectedName: 'Correct Guess',
    expected: {
      username: 'clarkio',
      // A hidden guess masks EVERY letter of the word, not a subset — the
      // length is all the main thread learns from the event itself. The
      // placeholders survive the worker untouched; the main thread resolves
      // the word against the Twitch chat log.
      letters: ['?', '?', '?', '?', '?', '?', '?'],
      index: 3,
      hitMax: true,
    },
  },
  {
    eventType: 4,
    fixture: '04-level-results.json',
    message: levelResults,
    expectedName: 'Level Results',
    expected: { stars: 5 },
  },
  {
    eventType: 5,
    fixture: '05-game-ended.json',
    message: gameEnded,
    expectedName: 'Game Ended',
    expected: { level: 12 },
  },
  {
    eventType: 6,
    fixture: '06-unknown-unhandled.json',
    message: unknown06,
    expectedName: null, // no branch in wos-worker.ts; meaning unknown
  },
  {
    eventType: 7,
    fixture: '07-letters-cycled.json',
    message: lettersCycled,
    expectedName: 'Letters Cycled',
    expected: { letters: ['n', 'o', 'i', 't', 'u', 'a', 'c'] },
  },
  {
    eventType: 8,
    fixture: '08-level-ended.json',
    message: levelEnded,
    expectedName: 'Level Ended',
    expected: { level: 3 },
  },
  {
    eventType: 9,
    fixture: '09-unknown-unhandled.json',
    message: unknown09,
    expectedName: null, // no branch in wos-worker.ts; meaning unknown
  },
  {
    eventType: 10,
    fixture: '10-letters-revealed.json',
    message: lettersRevealed,
    expectedName: 'Hidden/Fake Letters Revealed',
    expected: { hiddenLetters: ['a'], falseLetters: ['x', 'z'] },
  },
  {
    eventType: 11,
    fixture: '11-guessing-unlocked.json',
    message: guessingUnlocked,
    expectedName: 'Guessing Unlocked',
    expected: { letters: [], slots: [], level: 0 },
  },
  {
    eventType: 12,
    fixture: '12-game-connected.json',
    message: gameConnected,
    expectedName: 'Game Connected',
    expected: {
      level: 7,
      record: 21, // only event 12 carries the channel record through
      language: 2,
      letters: ['r', 'e', 'a', 'l', 'i', 't', 'y'],
      slots: gameConnected.data.slots,
    },
  },
];

describe('wos-worker', () => {
  describe('event type table (all 12 WoS event numbers)', () => {
    const handled = eventTable.filter(row => row.expectedName !== null);
    const unhandled = eventTable.filter(row => row.expectedName === null);

    it('covers every event type number from 1 to 12', () => {
      const covered = new Set(eventTable.map(row => row.eventType));
      expect([...covered].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
    });

    it.each(handled)(
      'event $eventType ($fixture) -> "$expectedName"',
      async ({ message, eventType, expectedName, expected }) => {
        send(message);

        const result = postedResult();
        expect(result).toMatchObject({
          type: 'wos_event',
          wosEventType: eventType,
          wosEventName: expectedName,
          ...expected,
        });
      }
    );

    it.each(unhandled)(
      'event $eventType ($fixture) is ignored without throwing',
      ({ message, eventType }) => {
        expect(() => { send(message); }).not.toThrow();

        expect(scope.postMessage).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `[WOS Worker] Unhandled WOS event type: ${eventType}`
        );
      }
    );

    it('has a table row for every fixture file on disk', async () => {
      const fixtureModules = import.meta.glob('../fixtures/wos-events/*.json');
      const onDisk = Object.keys(fixtureModules)
        .map(path => path.split('/').pop()!)
        .sort();
      const inTable = eventTable.map(row => row.fixture).sort();

      expect(inTable).toEqual(onDisk);
    });
  });

  describe('posted payload shape', () => {
    it('posts the complete result for a level start', () => {
      send(levelStart);

      expect(postedResult()).toEqual({
        type: 'wos_event',
        wosEventType: 1,
        wosEventName: 'Level Started',
        username: '',
        index: 0,
        letters: ['c', 'a', 'u', 't', 'i', 'o', 'n'],
        stars: 0,
        level: 3,
        record: undefined,
        hitMax: false,
        falseLetters: [],
        hiddenLetters: [],
        slots: levelStart.data.slots,
        language: undefined,
      });
    });

    it('posts the complete result for a correct guess', () => {
      send(correctGuess);

      expect(postedResult()).toEqual({
        type: 'wos_event',
        wosEventType: 3,
        wosEventName: 'Correct Guess',
        username: 'smc_may_i',
        index: 2,
        letters: ['c', 'o', 'a', 't'],
        stars: 0,
        // The correct-guess payload carries no level, and the worker's
        // module-level `currentLevel` is never read back into the result, so
        // level is reported as 0 here. GameSpectator only reads `level` for
        // events 1 and 12, which do carry it.
        level: 0,
        record: undefined,
        hitMax: false,
        falseLetters: [],
        hiddenLetters: [],
        slots: [],
        language: undefined,
      });
    });

    it('posts the complete result for game connected, including record and language', () => {
      send(gameConnected);

      expect(postedResult()).toEqual({
        type: 'wos_event',
        wosEventType: 12,
        wosEventName: 'Game Connected',
        username: '',
        index: 0,
        letters: ['r', 'e', 'a', 'l', 'i', 't', 'y'],
        stars: 0,
        level: 7,
        record: 21,
        hitMax: false,
        falseLetters: [],
        hiddenLetters: [],
        slots: gameConnected.data.slots,
        language: 2,
      });
    });

    it('drops the event 4 ranking data (it is not forwarded to the main thread)', () => {
      send(levelResults);

      // Via `unknown`: WosWorkerResult is a closed shape, so TS rejects the
      // direct widening. The point of this test is to inspect keys the type
      // says should not be there at all.
      const result = postedResult() as unknown as Record<string, unknown>;
      expect(result.stars).toBe(5);
      expect(result).not.toHaveProperty('ranking');
      expect(result).not.toHaveProperty('rankingTurn');
    });

    it('only forwards `record` for event 12', () => {
      // Event 5 carries no record, and the worker leaves the field undefined
      // for every event other than Game Connected.
      send(gameEnded);
      expect(postedResult().record).toBeUndefined();
    });

    it('lowercases the username but leaves letters untouched', () => {
      send({
        eventType: 3,
        data: { user: { name: 'MiXeDcAsE' }, letters: ['A', 'b', 'C', 'd'], index: 0 },
      });

      const result = postedResult();
      expect(result.username).toBe('mixedcase');
      expect(result.letters).toEqual(['A', 'b', 'C', 'd']);
    });

    it('does not carry level forward between events', () => {
      // Documents current behavior: `currentLevel` is tracked inside the worker
      // but never written back into the posted result, so an event without a
      // level reports 0 even right after a level-start event.
      send(levelStart);
      expect(postedResult().level).toBe(3);

      scope.postMessage.mockClear();
      send(correctGuess);
      expect(postedResult().level).toBe(0);
    });

    it('posts exactly one message per handled event', () => {
      send(levelStart);
      send(correctGuess);
      send(lettersRevealed);

      expect(scope.postMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe('malformed input', () => {
    // The worker thread must survive anything the socket hands it: a thrown
    // error inside onmessage would surface as an unhandled worker error and
    // (depending on the browser) tear down the worker, silently killing every
    // subsequent game event.

    it('does not throw and reports an error when the message is null', () => {
      expect(() => { send(null); }).not.toThrow();

      expect(postedResult()).toMatchObject({ type: 'error' });
    });

    it('does not throw and reports an error when `data` is missing', () => {
      expect(() => { send({ eventType: 3 }); }).not.toThrow();

      const result = postedResult() as unknown as { type: string; error: string };
      expect(result.type).toBe('error');
      expect(typeof result.error).toBe('string');
    });

    it('does not throw and reports an error when `data` is null', () => {
      expect(() => { send({ eventType: 1, data: null }); }).not.toThrow();

      expect(postedResult()).toMatchObject({ type: 'error' });
    });

    it('fills defaults for an empty payload', () => {
      expect(() => { send({ eventType: 1, data: {} }); }).not.toThrow();

      expect(postedResult()).toEqual({
        type: 'wos_event',
        wosEventType: 1,
        wosEventName: 'Level Started',
        username: '',
        index: 0,
        letters: [],
        stars: 0,
        level: 0,
        record: undefined,
        hitMax: false,
        falseLetters: [],
        hiddenLetters: [],
        slots: [],
        language: undefined,
      });
    });

    it('fills defaults when nested user data is partial', () => {
      expect(() => { send({ eventType: 3, data: { user: {} } }); }).not.toThrow();
      expect(postedResult().username).toBe('');

      scope.postMessage.mockClear();
      expect(() => { send({ eventType: 3, data: { user: null } }); }).not.toThrow();
      expect(postedResult().username).toBe('');
    });

    it('does not throw when fields have the wrong types', () => {
      // The worker is a pass-through: it does no type validation, so a
      // wrongly-typed field reaches the main thread as-is rather than being
      // coerced or rejected. Asserted here so a future change to that contract
      // is a deliberate one.
      expect(() =>
        { send({
          eventType: 3,
          data: {
            user: { name: 'someone' },
            letters: 'coat',
            index: 'two',
            hitMax: 'yes',
            stars: '5',
          },
        }); }
      ).not.toThrow();

      expect(postedResult()).toMatchObject({
        wosEventType: 3,
        letters: 'coat',
        index: 'two',
        hitMax: 'yes',
        stars: '5',
      });
    });

    it('does not throw when `data` is a primitive', () => {
      expect(() => { send({ eventType: 1, data: 42 }); }).not.toThrow();

      expect(postedResult()).toMatchObject({
        type: 'wos_event',
        wosEventType: 1,
        letters: [],
        level: 0,
      });
    });

    it('ignores an event type sent as a string (matching is strict)', () => {
      // Socket.IO delivers the event type as a number today. Strict `===`
      // comparisons mean a stringified type would fall through to the
      // unhandled branch rather than being processed.
      expect(() => { send({ eventType: '3', data: { letters: ['c'] } }); }).not.toThrow();

      expect(scope.postMessage).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[WOS Worker] Unhandled WOS event type: 3'
      );
    });

    it.each([
      ['missing event type', { data: { level: 1 } }],
      ['null event type', { eventType: null, data: {} }],
      ['negative event type', { eventType: -1, data: {} }],
      ['float event type', { eventType: 3.5, data: {} }],
      ['out-of-range event type', { eventType: 999, data: {} }],
      ['empty object', {}],
      ['array message', []],
      ['string message', 'not-a-message'],
      ['number message', 7],
    ])('survives %s', (_label, message) => {
      expect(() => { send(message); }).not.toThrow();

      // Either it was ignored, or it reported an error — never a thrown
      // exception, and never a bogus wos_event.
      const posted = scope.postMessage.mock.calls.map(call => call[0]?.type);
      expect(posted.every((type: string) => type === 'error')).toBe(true);
    });

    it('keeps processing valid events after a malformed one', () => {
      send(null);
      scope.postMessage.mockClear();

      send(correctGuess);

      expect(postedResult()).toMatchObject({
        type: 'wos_event',
        wosEventType: 3,
        username: 'smc_may_i',
      });
    });
  });

  describe('worker scope handlers', () => {
    it('installs onmessage, onerror and onmessageerror handlers', () => {
      expect(typeof scope.onmessage).toBe('function');
      expect(typeof scope.onerror).toBe('function');
      expect(typeof scope.onmessageerror).toBe('function');
    });

    it('logs worker errors instead of rethrowing them', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      const error = new Error('boom');

      expect(() => { scope.onerror!(error); }).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith('WOS Worker error:', error);

      consoleErrorSpy.mockRestore();
    });

    it('logs message deserialization errors instead of rethrowing them', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      const event = { data: 'corrupted' };

      expect(() => { scope.onmessageerror!(event); }).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith('WOS Worker Message Error:', event);

      consoleErrorSpy.mockRestore();
    });
  });
});
