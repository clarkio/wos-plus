import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findMissingWordsFromBoard, canFormWord } from '@scripts/wos-words';
import type { Slot } from '@scripts/wos-words';

/**
 * Unit tests for the wos-words.ts dictionary and word-matching engine.
 *
 * The module keeps the dictionary in module-level state, so every test that
 * depends on it imports a pristine copy via `importFreshModule()` instead of
 * relying on the statically imported binding above (which is only used by the
 * tests for the module's pure functions).
 *
 * The network is stubbed at the boundary — `global.fetch` — so the module's own
 * request building, response handling and parsing all really run. No test in
 * this file is allowed to reach the network.
 */

type WosWordsModule = typeof import('@scripts/wos-words');

/** Endpoint `loadWordsFromDb()` reads the dictionary from. */
const WORDS_API_URL = '/api/words';
/** Endpoint `updateWordsDb()` PATCHes newly discovered words to. */
const WOS_DICTIONARY_URL = 'https://clarkio.com/wos-dictionary';

/**
 * A tiny hand-picked dictionary used with the letters 'ater'.
 * 'tree' needs two e's and 'treat' needs two t's, so both are unformable from
 * 'ater' and exercise the letter-frequency accounting. 'rat' is below the
 * usual 4-letter minimum so it exercises the length filter.
 */
const TEST_DICTIONARY = ['rate', 'tear', 'rat', 'tree', 'treat'];

let fetchMock: ReturnType<typeof vi.fn>;

/** Builds a minimal successful `Response` carrying `body` as JSON. */
function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

/** Builds a minimal failed `Response` with the given HTTP status. */
function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
  } as Response;
}

/** Imports a copy of the module with its dictionary state reset to empty. */
async function importFreshModule(): Promise<WosWordsModule> {
  vi.resetModules();
  return import('@scripts/wos-words');
}

/**
 * Imports a fresh module whose dictionary has been populated with `words`
 * through the real `loadWordsFromDb()` parsing path, then clears the fetch mock
 * so tests can assert on the requests they make themselves.
 */
async function importModuleWithDictionary(words: string[]): Promise<WosWordsModule> {
  const wosWords = await importFreshModule();
  fetchMock.mockResolvedValueOnce(okResponse(words));
  await wosWords.loadWordsFromDb();
  fetchMock.mockClear();
  return wosWords;
}

describe('wos-words module', () => {
  beforeEach(() => {
    // Setup before each test
    vi.clearAllMocks();

    // Stub the network boundary. The default implementation fails loudly so an
    // unexpected request surfaces as a test failure rather than a real call.
    fetchMock = vi.fn(async () => {
      throw new Error('Unexpected network request');
    });
    vi.stubGlobal('fetch', fetchMock);

    // The module logs on nearly every code path; silence it to keep the output
    // readable while still allowing assertions on what was logged.
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // findWosWordsByLetters is module-private; it is exercised through
  // findAllMissingWords, which is the only way the application reaches it.
  describe('findWosWordsByLetters (via findAllMissingWords)', () => {
    it('should find the dictionary words that can be spelled from the given letters', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect([...result].sort()).toEqual(['rate', 'tear']);
    });

    it('should not match a word needing two of a letter when only one is available', async () => {
      // Arrange - 'tree' needs two e's, the letters below only offer one
      const wosWords = await importModuleWithDictionary(['tree']);

      // Act
      const result = wosWords.findAllMissingWords([], 'tre', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should match a word needing two of a letter when both are available', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(['tree']);

      // Act
      const result = wosWords.findAllMissingWords([], 'tree', 4);

      // Assert
      expect(result).toEqual(['tree']);
    });

    it('should not match a word that needs a letter which is not available at all', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(['ghost']);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should treat the given letters case-insensitively', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'ATER', 4);

      // Assert
      expect([...result].sort()).toEqual(['rate', 'tear']);
    });

    it('should match dictionary entries regardless of the case they are stored in', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(['TEAR']);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert - matches are normalised to lower case
      expect(result).toEqual(['tear']);
    });

    it('should ignore non-alphabetic characters among the given letters', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'a-t-e-r!', 4);

      // Assert
      expect([...result].sort()).toEqual(['rate', 'tear']);
    });

    it('should return an empty array when no letters are given', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], '', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return an empty array when the letters are only whitespace', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], '   ', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should list each match only once when the dictionary repeats a word', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(['rate', 'RATE', 'rate']);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect(result).toEqual(['rate']);
    });

    it('should return the matches sorted from longest to shortest', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 3);

      // Assert - assert on the shape of the ordering, not on dictionary order
      const lengths = result.map(word => word.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    });
  });

  describe('findAllMissingWords', () => {
    it('should report the formable dictionary words that were not guessed', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords(['rate'], 'ater', 4);

      // Assert
      expect(result).toEqual(['tear']);
    });

    it('should exclude words that were already guessed', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords(['rate'], 'ater', 4);

      // Assert
      expect(result).not.toContain('rate');
    });

    it('should exclude already guessed words regardless of their casing', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords(['RATE'], 'ater', 4);

      // Assert
      expect(result).not.toContain('rate');
    });

    it('should exclude words already reported as missed with the trailing * marker', async () => {
      // Arrange - the level-end pipeline pushes missed words back into the
      // correct-words list carrying the '*' marker it displays them with, and
      // it can run twice for the same level (level results, then game end).
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords(['rate*'], 'ater', 4);

      // Assert
      expect(result).not.toContain('rate');
    });

    it('should exclude words below the minimum length', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect(result).not.toContain('rat');
    });

    it('should include shorter words when the minimum length allows them', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 3);

      // Assert
      expect(result).toContain('rat');
    });

    it('should return an empty array when every formable word was guessed', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords(['rate', 'tear'], 'ater', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return an empty array when no dictionary word can be formed', async () => {
      // Arrange
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      // Act
      const result = wosWords.findAllMissingWords([], 'xyzw', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return an empty array when the dictionary failed to load', async () => {
      // Arrange - loadWordsFromDb swallows failures, so callers can reach this
      // with no dictionary at all; it must degrade rather than throw.
      const wosWords = await importFreshModule();
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      await wosWords.loadWordsFromDb();

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return an empty array before the dictionary has been loaded', async () => {
      // Arrange
      const wosWords = await importFreshModule();

      // Act
      const result = wosWords.findAllMissingWords([], 'ater', 4);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('findMissingWordsFromBoard', () => {
    it('should identify words not guessed by comparing with board slots', () => {
      const currentSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: '', user: undefined, hitMax: false }, // Empty slot
        { letters: ['m', 'i', 's', 's'], word: '', user: undefined, hitMax: false }, // Empty slot
      ];

      const boardSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false },
        { letters: ['m', 'i', 's', 's'], word: 'miss', user: 'user3', hitMax: false },
      ];

      const result = findMissingWordsFromBoard(currentSlots, boardSlots);

      expect(result).toEqual(['word', 'miss']);
    });

    it('should return empty array when all words are guessed', () => {
      const currentSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false },
      ];

      const boardSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false },
      ];

      const result = findMissingWordsFromBoard(currentSlots, boardSlots);

      expect(result).toEqual([]);
    });

    it('should handle case-insensitive word matching', () => {
      const currentSlots: Slot[] = [
        { letters: ['T', 'E', 'S', 'T'], word: 'TEST', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: '', user: undefined, hitMax: false },
      ];

      const boardSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: ['w', 'o', 'r', 'd'], word: 'word', user: 'user2', hitMax: false },
      ];

      const result = findMissingWordsFromBoard(currentSlots, boardSlots);

      expect(result).toEqual(['word']);
    });

    it('should skip empty words in board data', () => {
      const currentSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
      ];

      const boardSlots: Slot[] = [
        { letters: ['t', 'e', 's', 't'], word: 'test', user: 'user1', hitMax: false },
        { letters: [], word: '', user: undefined, hitMax: false }, // Empty in board data too
      ];

      const result = findMissingWordsFromBoard(currentSlots, boardSlots);

      expect(result).toEqual([]);
    });
  });

  describe('canFormWord', () => {
    it('should return true when the word fits within the available letters', () => {
      expect(canFormWord('beard', ['b', 'e', 'a', 'r', 'd'])).toBe(true);
    });

    it('should ignore extra available letters', () => {
      expect(canFormWord('beard', ['b', 'e', 'a', 'r', 'd', 'x', 'y', 'z'])).toBe(true);
    });

    it('should return false when a required letter is missing', () => {
      expect(canFormWord('ghost', ['b', 'e', 'a', 'r', 'd'])).toBe(false);
    });

    it('should respect letter frequency (duplicate letters need duplicate tiles)', () => {
      // "letter" needs two t's and two e's.
      expect(canFormWord('letter', ['l', 'e', 't', 'r'])).toBe(false);
      expect(canFormWord('letter', ['l', 'e', 'e', 't', 't', 'r'])).toBe(true);
    });

    it('should treat ? as a wildcard for any single letter', () => {
      expect(canFormWord('trilby', ['t', 'l', 'r', 'i', 'b', '?'])).toBe(true);
    });

    it('should consume one wildcard per unmatched letter', () => {
      // Two missing letters (s, and a second t) need two wildcards.
      expect(canFormWord('toast', ['o', 'a', '?'])).toBe(false);
      expect(canFormWord('toast', ['o', 'a', '?', '?', '?'])).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(canFormWord('BEARD', ['B', 'E', 'A', 'R', 'D'])).toBe(true);
      expect(canFormWord('Beard', ['b', 'e', 'a', 'r', 'd'])).toBe(true);
    });

    it('should return false for an empty word', () => {
      expect(canFormWord('', ['a', 'b', 'c'])).toBe(false);
    });

    it('should return false when there are no available letters', () => {
      expect(canFormWord('beard', [])).toBe(false);
    });
  });

  describe('loadWordsFromDb', () => {
    it('should load words from the API endpoint', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockResolvedValueOnce(okResponse(TEST_DICTIONARY));

      await wosWords.loadWordsFromDb();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(WORDS_API_URL);
    });

    it('should populate the dictionary with the loaded words', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockResolvedValueOnce(okResponse(TEST_DICTIONARY));

      await wosWords.loadWordsFromDb();

      expect(wosWords.isWosWord('rate')).toBe(true);
      expect(wosWords.isWosWord('notaword')).toBe(false);
    });

    it('should trim surrounding whitespace from loaded words', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockResolvedValueOnce(okResponse(['  rate  ', '\ttear\n']));

      await wosWords.loadWordsFromDb();

      expect(wosWords.isWosWord('rate')).toBe(true);
      expect(wosWords.isWosWord('tear')).toBe(true);
    });

    it('should match loaded words case-insensitively', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockResolvedValueOnce(okResponse(['Rate']));

      await wosWords.loadWordsFromDb();

      expect(wosWords.isWosWord('rate')).toBe(true);
      expect(wosWords.isWosWord('RATE')).toBe(true);
    });

    it('should swallow a non-ok API response rather than throwing', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

      await expect(wosWords.loadWordsFromDb()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    });

    it('should swallow a network rejection rather than throwing', async () => {
      const wosWords = await importFreshModule();
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      await expect(wosWords.loadWordsFromDb()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    });

    it('should leave the dictionary usable after a failed load', async () => {
      // Regression: loadWordsFromDb() deliberately swallows failures, so every
      // consumer can run against a dictionary that was never populated. It used
      // to be left `undefined`, which made findAllMissingWords throw outright.
      const wosWords = await importFreshModule();
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      await wosWords.loadWordsFromDb();

      expect(wosWords.isWosWord('rate')).toBe(false);
      expect(() => wosWords.findAllMissingWords([], 'ater', 4)).not.toThrow();
      expect(wosWords.findAllMissingWords([], 'ater', 4)).toEqual([]);
    });
  });

  describe('updateWordsDb', () => {
    it('should PATCH an unknown word to the dictionary endpoint', async () => {
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);
      fetchMock.mockResolvedValueOnce(okResponse({ ok: true }));

      await wosWords.updateWordsDb('stare');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(WOS_DICTIONARY_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'stare' }),
      });
    });

    it('should add the new word to the in-memory dictionary on success', async () => {
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);
      fetchMock.mockResolvedValueOnce(okResponse({ ok: true }));

      await wosWords.updateWordsDb('stare');

      expect(wosWords.isWosWord('stare')).toBe(true);
    });

    it('should skip a word already present in the dictionary', async () => {
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      await wosWords.updateWordsDb('rate');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should skip a known word that differs only in case', async () => {
      // The dictionary is matched case-insensitively everywhere else, so an
      // already-known word must not be re-sent just because its casing differs.
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);

      await wosWords.updateWordsDb('RATE');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should reject when the PATCH returns a non-ok response', async () => {
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);
      fetchMock.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

      await expect(wosWords.updateWordsDb('stare')).rejects.toThrow('503');
      expect(wosWords.isWosWord('stare')).toBe(false);
    });

    it('should reject when the PATCH request itself fails', async () => {
      const wosWords = await importModuleWithDictionary(TEST_DICTIONARY);
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      await expect(wosWords.updateWordsDb('stare')).rejects.toThrow('offline');
      expect(console.error).toHaveBeenCalled();
    });
  });
});
