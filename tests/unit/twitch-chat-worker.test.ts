import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TwitchWorkerMessage } from '@scripts/twitch-chat-worker';

/**
 * Unit tests for src/scripts/twitch-chat-worker.ts — the Web Worker that
 * filters Twitch chat down to plausible WoS guesses (/^[a-zA-Z]{4,12}$/) before
 * `GameSpectator` correlates them with masked correct-guess events.
 *
 * These tests drive the REAL module. An earlier version of this file declared a
 * local copy of the worker's filtering logic inside `beforeEach` and asserted
 * against that copy, so it imported only types, never executed a line of
 * src/, and reported 0% coverage while appearing to pass 23 tests. Anything
 * added here must go through `loadWorkerWithFreshScope()` so it exercises
 * production code.
 *
 * The worker installs its handlers on `self` (worker scope, no DOM), so the
 * harness stubs `globalThis.self`, imports the module so it binds to that stub,
 * then invokes `self.onmessage` directly and asserts on `self.postMessage`.
 */

/** The subset of `WorkerGlobalScope` that twitch-chat-worker.ts actually uses. */
interface WorkerScopeStub {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

let scope: WorkerScopeStub;

/** Fresh worker scope + a fresh module instance bound to it. */
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
  await import('@scripts/twitch-chat-worker');
}

/** Delivers a chat message to the worker exactly as the main thread would. */
async function send(data: Partial<TwitchWorkerMessage> | null): Promise<void> {
  await loadWorkerWithFreshScope();
  scope.onmessage?.(new MessageEvent('message', { data }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('twitch-chat-worker', () => {
  describe('message filtering', () => {
    it.each([
      ['a 4-letter word (lower bound)', 'word'],
      ['a 12-letter word (upper bound)', 'exactlytwelv'],
      ['a mixed-case word', 'WoRdS'],
    ])('forwards %s', async (_label, message) => {
      await send({ username: 'TestUser', message, timestamp: 1000 });

      expect(scope.postMessage).toHaveBeenCalledTimes(1);
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'twitch_message',
        username: 'testuser',
        message: message.toLowerCase(),
        timestamp: 1000,
      });
    });

    it.each([
      ['3 letters (below the lower bound)', 'cat'],
      ['13 letters (above the upper bound)', 'thirteenlettr'],
      ['digits', 'test123'],
      ['punctuation', 'test!'],
      ['an embedded space', 'test word'],
      ['an empty string', ''],
      ['leading whitespace', ' word'],
      ['a non-ASCII letter', 'wörd'],
    ])('drops %s', async (_label, message) => {
      await send({ username: 'TestUser', message, timestamp: 1000 });

      expect(scope.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('data transformation', () => {
    it('lower-cases the username so it matches WoS event usernames', async () => {
      await send({ username: 'TestUser', message: 'word', timestamp: 1000 });

      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'testuser' }),
      );
    });

    it('preserves the timestamp used to correlate guesses', async () => {
      await send({ username: 'user', message: 'word', timestamp: 1234567890 });

      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: 1234567890 }),
      );
    });
  });

  describe('malformed input', () => {
    it('reports an error instead of throwing when the payload is null', async () => {
      await send(null);

      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });

    it('reports an error when the username is missing', async () => {
      await send({ message: 'word', timestamp: 1000 });

      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });

    it('reports an error when the message is missing', async () => {
      // Note: `messageRegex.test(undefined)` coerces to the string "undefined",
      // which is 9 ASCII letters and so passes the filter. The failure surfaces
      // one line later on `message.toLowerCase()` and is caught. Asserting the
      // error path here pins that behaviour.
      await send({ username: 'user', timestamp: 1000 });

      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      );
    });

    it('never lets an error escape the worker', async () => {
      await expect(send(null)).resolves.toBeUndefined();
    });
  });

  describe('sequences', () => {
    it('forwards only the valid messages in a mixed batch', async () => {
      await loadWorkerWithFreshScope();

      const batch: TwitchWorkerMessage[] = [
        { username: 'user1', message: 'word', timestamp: 1000 },
        { username: 'user2', message: 'hi', timestamp: 2000 },
        { username: 'user3', message: 'test123', timestamp: 3000 },
        { username: 'user4', message: 'game', timestamp: 4000 },
      ];
      for (const data of batch) {
        scope.onmessage?.(new MessageEvent('message', { data }));
      }

      expect(scope.postMessage).toHaveBeenCalledTimes(2);
      expect(scope.postMessage).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ message: 'word' }));
      expect(scope.postMessage).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ message: 'game' }));
    });
  });

  describe('worker-level handlers', () => {
    it('installs onerror and onmessageerror handlers that log', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      await loadWorkerWithFreshScope();

      expect(scope.onerror).toBeTypeOf('function');
      expect(scope.onmessageerror).toBeTypeOf('function');

      scope.onerror?.('boom');
      scope.onmessageerror?.('corrupt');

      expect(consoleSpy).toHaveBeenCalledWith('Twitch Worker Error:', 'boom');
      expect(consoleSpy).toHaveBeenCalledWith('Twitch Worker Message Error:', 'corrupt');
    });
  });
});
