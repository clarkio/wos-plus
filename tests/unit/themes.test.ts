import { describe, it, expect } from 'vitest';
import {
  THEMES,
  THEME_IDS,
  isThemeId,
  resolveTheme,
} from '../../src/data/themes';

/**
 * The settings dialog's theme picker and the before-first-paint script in
 * WosBaseLayout both read the theme list from src/data/themes.ts. These tests
 * pin that list and the rule for choosing which theme a view starts in.
 */
describe('theme list', () => {
  it('offers Default, Sticker Pop and Halloween, in that order', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['default', 'sticker-pop', 'halloween']);
    expect(THEMES.map((t) => t.label)).toEqual(['Default', 'Sticker Pop', 'Halloween']);
  });

  it('exposes the ids as a plain list for the inline scripts', () => {
    expect(THEME_IDS).toEqual(THEMES.map((t) => t.id));
  });

  it('never gives two themes the same id', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });
});

describe('isThemeId', () => {
  it.each(['default', 'sticker-pop', 'halloween'])('accepts %s', (id) => {
    expect(isThemeId(id)).toBe(true);
  });

  it.each([null, undefined, '', 'Halloween', 'dark', 42])('rejects %s', (value) => {
    expect(isThemeId(value)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('uses a stored, known theme over the view default', () => {
    expect(resolveTheme('halloween', 'sticker-pop')).toBe('halloween');
  });

  it('falls back to the view default when nothing is stored', () => {
    expect(resolveTheme(null, 'sticker-pop')).toBe('sticker-pop');
  });

  it('ignores a stored value that is not a theme', () => {
    expect(resolveTheme('spooky', 'sticker-pop')).toBe('sticker-pop');
  });

  it('falls back to "default" when the view default is not a theme either', () => {
    expect(resolveTheme('spooky', 'nope')).toBe('default');
  });
});
