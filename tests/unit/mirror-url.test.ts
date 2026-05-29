import { describe, it, expect } from 'vitest';
import {
  WOS_MIRROR_BASE,
  isValidGameId,
  getMirrorGameId,
  normalizeMirrorUrl,
} from '@scripts/mirror-url';

const GAME_ID = '4fdfc856-0328-4384-a882-8377dcb5a4f6';
const MIRROR_URL = `https://wos.gg/r/${GAME_ID}`;

describe('isValidGameId', () => {
  it('accepts a UUID game id', () => {
    expect(isValidGameId(GAME_ID)).toBe(true);
  });

  it('accepts a UUID regardless of casing and surrounding whitespace', () => {
    expect(isValidGameId(`  ${GAME_ID.toUpperCase()}  `)).toBe(true);
  });

  it('rejects non-UUID values', () => {
    expect(isValidGameId('not-a-uuid')).toBe(false);
    expect(isValidGameId('1234')).toBe(false);
    expect(isValidGameId('')).toBe(false);
    expect(isValidGameId(`${GAME_ID}-extra`)).toBe(false);
  });
});

describe('getMirrorGameId', () => {
  it('extracts the game id from a canonical mirror URL', () => {
    expect(getMirrorGameId(MIRROR_URL)).toBe(GAME_ID);
  });

  it('accepts a bare game id', () => {
    expect(getMirrorGameId(GAME_ID)).toBe(GAME_ID);
  });

  it('trims surrounding whitespace', () => {
    expect(getMirrorGameId(`  ${MIRROR_URL}  `)).toBe(GAME_ID);
  });

  it('returns null for empty / nullish input', () => {
    expect(getMirrorGameId('')).toBeNull();
    expect(getMirrorGameId('   ')).toBeNull();
    expect(getMirrorGameId(undefined as unknown as string)).toBeNull();
  });

  it('rejects other hosts (the picture-in-picture bug)', () => {
    expect(getMirrorGameId(`https://wosplus.com/r/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`https://player.wosplus.com/r/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`https://evil.example.com/r/${GAME_ID}`)).toBeNull();
  });

  it('rejects look-alike / subdomain hosts', () => {
    expect(getMirrorGameId(`https://wos.gg.evil.com/r/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`https://notwos.gg/r/${GAME_ID}`)).toBeNull();
    // A subdomain of the real host is still not the canonical host.
    expect(getMirrorGameId(`https://www.wos.gg/r/${GAME_ID}`)).toBeNull();
  });

  it('rejects non-https schemes', () => {
    expect(getMirrorGameId(`http://wos.gg/r/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`javascript:alert(1)//wos.gg/r/${GAME_ID}`)).toBeNull();
  });

  it('rejects wrong / extra path segments', () => {
    expect(getMirrorGameId('https://wos.gg/')).toBeNull();
    expect(getMirrorGameId(`https://wos.gg/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`https://wos.gg/x/${GAME_ID}`)).toBeNull();
    expect(getMirrorGameId(`https://wos.gg/r/${GAME_ID}/extra`)).toBeNull();
  });

  it('rejects a valid host/path but invalid (non-UUID) id', () => {
    expect(getMirrorGameId('https://wos.gg/r/not-a-uuid')).toBeNull();
  });

  it('ignores query strings and fragments around a valid path', () => {
    expect(getMirrorGameId(`${MIRROR_URL}?foo=bar#baz`)).toBe(GAME_ID);
  });
});

describe('normalizeMirrorUrl', () => {
  it('normalizes a bare game id to the canonical URL', () => {
    expect(normalizeMirrorUrl(GAME_ID)).toBe(`${WOS_MIRROR_BASE}${GAME_ID}`);
  });

  it('returns the canonical URL for an already-canonical URL', () => {
    expect(normalizeMirrorUrl(MIRROR_URL)).toBe(MIRROR_URL);
  });

  it('strips query strings and fragments to the canonical form', () => {
    expect(normalizeMirrorUrl(`${MIRROR_URL}?a=1#x`)).toBe(MIRROR_URL);
  });

  it('returns null for invalid input', () => {
    expect(normalizeMirrorUrl('')).toBeNull();
    expect(normalizeMirrorUrl(`https://wosplus.com/r/${GAME_ID}`)).toBeNull();
    expect(normalizeMirrorUrl('https://wos.gg/r/not-a-uuid')).toBeNull();
  });
});
