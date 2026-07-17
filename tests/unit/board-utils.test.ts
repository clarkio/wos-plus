import { describe, it, expect } from 'vitest';
import { coerceSlots, findRedundantWords, hasRedundantWords, normalizeLanguageCode, normalizeTwitchChannel, wosLanguageIdToCode } from '@/lib/board-utils';

/**
 * Unit tests for board-utils.ts module (issue #119)
 */

describe('board-utils module', () => {
  describe('findRedundantWords', () => {
    it('should return empty array for slots with distinct words', () => {
      const slots = [
        { word: 'test' },
        { word: 'word' },
        { word: 'board' },
      ];

      expect(findRedundantWords(slots)).toEqual([]);
    });

    it('should detect a word that appears in multiple slots', () => {
      const slots = [
        { word: 'test' },
        { word: 'word' },
        { word: 'test' },
      ];

      expect(findRedundantWords(slots)).toEqual(['test']);
    });

    it('should detect redundant words case-insensitively', () => {
      const slots = [
        { word: 'Test' },
        { word: 'TEST' },
      ];

      expect(findRedundantWords(slots)).toEqual(['test']);
    });

    it('should report each redundant word once', () => {
      const slots = [
        { word: 'test' },
        { word: 'test' },
        { word: 'test' },
        { word: 'word' },
        { word: 'word' },
      ];

      expect(findRedundantWords(slots)).toEqual(['test', 'word']);
    });

    it('should ignore slots without a usable word', () => {
      const slots = [
        { word: '' },
        { word: '' },
        {},
        null,
        { word: 123 },
        { word: 'test' },
      ];

      expect(findRedundantWords(slots)).toEqual([]);
    });

    it('should return empty array for non-array input', () => {
      expect(findRedundantWords(null)).toEqual([]);
      expect(findRedundantWords(undefined)).toEqual([]);
      expect(findRedundantWords('slots')).toEqual([]);
      expect(findRedundantWords({})).toEqual([]);
    });

    it('should detect redundant words in a JSON-string slots column', () => {
      const stored = JSON.stringify([
        { word: 'test' },
        { word: 'word' },
        { word: 'test' },
      ]);

      expect(findRedundantWords(stored)).toEqual(['test']);
    });

    it('should return empty array for a clean JSON-string slots column', () => {
      const stored = JSON.stringify([{ word: 'test' }, { word: 'word' }]);

      expect(findRedundantWords(stored)).toEqual([]);
    });
  });

  describe('hasRedundantWords', () => {
    it('should return false for clean slots', () => {
      expect(hasRedundantWords([{ word: 'test' }, { word: 'word' }])).toBe(false);
    });

    it('should return true when a word is duplicated', () => {
      expect(hasRedundantWords([{ word: 'test' }, { word: 'test' }])).toBe(true);
    });

    it('should return false for non-array input', () => {
      expect(hasRedundantWords(null)).toBe(false);
    });

    it('should return true for a JSON-string slots column with duplicates', () => {
      expect(hasRedundantWords(JSON.stringify([{ word: 'test' }, { word: 'test' }]))).toBe(true);
    });
  });

  describe('coerceSlots', () => {
    it('should return an array unchanged', () => {
      const slots = [{ word: 'test' }];
      expect(coerceSlots(slots)).toBe(slots);
    });

    it('should parse a JSON-string array', () => {
      expect(coerceSlots('[{"word":"test"}]')).toEqual([{ word: 'test' }]);
    });

    it('should return null for JSON that is not an array', () => {
      expect(coerceSlots('{"word":"test"}')).toBeNull();
    });

    it('should return null for invalid JSON and non-slot values', () => {
      expect(coerceSlots('not json')).toBeNull();
      expect(coerceSlots(null)).toBeNull();
      expect(coerceSlots(undefined)).toBeNull();
      expect(coerceSlots(42)).toBeNull();
      expect(coerceSlots({})).toBeNull();
    });
  });

  describe('normalizeTwitchChannel', () => {
    it('should lowercase and trim a valid channel name', () => {
      expect(normalizeTwitchChannel('  Clarkio ')).toBe('clarkio');
    });

    it('should strip a leading # from the channel name', () => {
      expect(normalizeTwitchChannel('#clarkio')).toBe('clarkio');
    });

    it('should accept digits and underscores', () => {
      expect(normalizeTwitchChannel('some_user123')).toBe('some_user123');
    });

    it('should return null for invalid characters', () => {
      expect(normalizeTwitchChannel('bad channel')).toBeNull();
      expect(normalizeTwitchChannel('bad;drop')).toBeNull();
      expect(normalizeTwitchChannel('name!')).toBeNull();
    });

    it('should return null for empty or non-string input', () => {
      expect(normalizeTwitchChannel('')).toBeNull();
      expect(normalizeTwitchChannel('#')).toBeNull();
      expect(normalizeTwitchChannel(null)).toBeNull();
      expect(normalizeTwitchChannel(undefined)).toBeNull();
      expect(normalizeTwitchChannel(42)).toBeNull();
    });

    it('should return null for names longer than 50 characters', () => {
      expect(normalizeTwitchChannel('a'.repeat(51))).toBeNull();
      expect(normalizeTwitchChannel('a'.repeat(50))).toBe('a'.repeat(50));
    });
  });

  describe('wosLanguageIdToCode (issue #124)', () => {
    it('should map the WoS language ids to their codes', () => {
      expect(wosLanguageIdToCode(1)).toBe('pt');
      expect(wosLanguageIdToCode(2)).toBe('en');
      expect(wosLanguageIdToCode(4)).toBe('fr');
    });

    it('should return null for unknown ids', () => {
      expect(wosLanguageIdToCode(0)).toBeNull();
      expect(wosLanguageIdToCode(3)).toBeNull();
      expect(wosLanguageIdToCode(5)).toBeNull();
      expect(wosLanguageIdToCode(-1)).toBeNull();
    });

    it('should return null for non-integer input', () => {
      expect(wosLanguageIdToCode('2')).toBeNull();
      expect(wosLanguageIdToCode(2.5)).toBeNull();
      expect(wosLanguageIdToCode(null)).toBeNull();
      expect(wosLanguageIdToCode(undefined)).toBeNull();
      expect(wosLanguageIdToCode({})).toBeNull();
    });
  });

  describe('normalizeLanguageCode (issue #124)', () => {
    it('should accept the supported language codes', () => {
      expect(normalizeLanguageCode('en')).toBe('en');
      expect(normalizeLanguageCode('pt')).toBe('pt');
      expect(normalizeLanguageCode('fr')).toBe('fr');
    });

    it('should lowercase and trim the code', () => {
      expect(normalizeLanguageCode('EN')).toBe('en');
      expect(normalizeLanguageCode(' Fr ')).toBe('fr');
    });

    it('should return null for unsupported codes', () => {
      expect(normalizeLanguageCode('es')).toBeNull();
      expect(normalizeLanguageCode('english')).toBeNull();
      expect(normalizeLanguageCode('e')).toBeNull();
    });

    it('should return null for empty or non-string input', () => {
      expect(normalizeLanguageCode('')).toBeNull();
      expect(normalizeLanguageCode(null)).toBeNull();
      expect(normalizeLanguageCode(undefined)).toBeNull();
      expect(normalizeLanguageCode(2)).toBeNull();
    });
  });
});
