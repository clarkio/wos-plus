import { describe, it, expect } from 'vitest';
import { findRedundantWords, hasRedundantWords } from '@/lib/board-utils';

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
  });
});
