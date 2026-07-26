import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getMirrorGameId,
  isValidGameId,
  normalizeMirrorUrl,
  WOS_MIRROR_BASE,
} from '@scripts/mirror-url';
import { propertyRunConfig } from './fc-config';

/**
 * Property-based tests for the mirror URL parser (issue #150, plan phase 4).
 *
 * `normalizeMirrorUrl` / `getMirrorGameId` are an encode/decode pair, which is
 * the classic shape for a round-trip property: whatever id goes in must come
 * back out unchanged. Example tests here would only ever check the handful of
 * ids somebody thought to type; the round-trip property checks it for hundreds
 * of generated UUIDs, and the totality properties check that *no* input — valid
 * URL, hostile URL, or arbitrary junk — can make these functions return
 * something that isn't a real game id.
 */

/**
 * Independent structural check for "is this a WoS game id".
 *
 * Deliberately NOT the production regex (and not imported from the module under
 * test) — it is written as an explicit segment/length/hex-digit walk so that a
 * mistake in `GAME_ID_PATTERN` (a wrong segment length, a missing anchor, a
 * character class that leaks non-hex characters) shows up as a disagreement
 * instead of being silently mirrored by the test.
 */
const HEX_DIGITS = '0123456789abcdefABCDEF';
const GAME_ID_SEGMENT_LENGTHS = [8, 4, 4, 4, 12];

function looksLikeGameId(value: string): boolean {
  const segments = value.trim().split('-');
  if (segments.length !== GAME_ID_SEGMENT_LENGTHS.length) {
    return false;
  }
  return segments.every(
    (segment, index) =>
      segment.length === GAME_ID_SEGMENT_LENGTHS[index] &&
      // UUID segments are hex ASCII by construction; no surrogate pairs.
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      [...segment].every((char) => HEX_DIGITS.includes(char))
  );
}

/** Game ids as they really appear: lowercase UUIDs, plus the uppercase variant. */
const gameIdArb = fc.oneof(
  fc.uuid(),
  fc.uuid().map((id) => id.toUpperCase()),
);

/**
 * Inputs that are *not* bare game ids: random text, unrelated URLs, and the
 * near-miss URLs an attacker or a typo would produce (wrong scheme, wrong host,
 * lookalike host, wrong path, extra path segment).
 */
const nonGameIdArb = fc.oneof(
  fc.string(),
  fc.string({ maxLength: 80 }),
  fc.webUrl(),
  fc.uuid().map((id) => `https://example.com/r/${id}`),
  fc.uuid().map((id) => `http://wos.gg/r/${id}`),
  fc.uuid().map((id) => `https://evil-wos.gg/r/${id}`),
  fc.uuid().map((id) => `https://wos.gg.attacker.test/r/${id}`),
  fc.uuid().map((id) => `https://wos.gg/x/${id}`),
  fc.uuid().map((id) => `https://wos.gg/r/${id}/extra`),
  fc.uuid().map((id) => id.slice(0, -1)),
  fc.uuid().map((id) => `${id}${id}`),
);

/** Anything at all that could reach these functions from a form field. */
const anyInputArb = fc.oneof(
  gameIdArb,
  nonGameIdArb,
  gameIdArb.map((id) => `${WOS_MIRROR_BASE}${id}`),
  gameIdArb.map((id) => `  ${WOS_MIRROR_BASE}${id}  `),
  gameIdArb.map((id) => `  ${id}\n`),
  gameIdArb.map((id) => `${WOS_MIRROR_BASE}${id}?spectate=1#top`),
);

describe('mirror-url properties', () => {
  describe('normalizeMirrorUrl / getMirrorGameId round-trip', () => {
    it('recovers the exact game id from the URL it was normalized into', () => {
      fc.assert(
        fc.property(gameIdArb, (gameId) => {
          const url = normalizeMirrorUrl(gameId);
          expect(url).not.toBeNull();
          expect(getMirrorGameId(url as string)).toBe(gameId);
        }),
        propertyRunConfig
      );
    });

    it('normalizes a bare game id to exactly the canonical mirror URL', () => {
      fc.assert(
        fc.property(gameIdArb, (gameId) => {
          expect(normalizeMirrorUrl(gameId)).toBe(`${WOS_MIRROR_BASE}${gameId}`);
        }),
        propertyRunConfig
      );
    });

    it('recovers the game id whether the URL or the bare id was pasted, including with surrounding whitespace', () => {
      fc.assert(
        fc.property(
          gameIdArb,
          fc.constantFrom('', ' ', '  ', '\n', '\t '),
          fc.constantFrom('', ' ', '\n'),
          (gameId, before, after) => {
            expect(getMirrorGameId(`${before}${gameId}${after}`)).toBe(gameId);
            expect(
              getMirrorGameId(`${before}${WOS_MIRROR_BASE}${gameId}${after}`)
            ).toBe(gameId);
          }
        ),
        propertyRunConfig
      );
    });

    it('is idempotent: normalizing an already-canonical URL changes nothing', () => {
      fc.assert(
        fc.property(anyInputArb, (input) => {
          const once = normalizeMirrorUrl(input);
          const twice = once === null ? null : normalizeMirrorUrl(once);
          expect(twice).toBe(once);
        }),
        propertyRunConfig
      );
    });
  });

  describe('isValidGameId agrees with an independent game-id check', () => {
    it('accepts every generated UUID', () => {
      fc.assert(
        fc.property(gameIdArb, (gameId) => {
          expect(looksLikeGameId(gameId)).toBe(true);
          expect(isValidGameId(gameId)).toBe(true);
        }),
        propertyRunConfig
      );
    });

    it('rejects arbitrary strings that are not game ids', () => {
      fc.assert(
        fc.property(
          nonGameIdArb.filter((value) => !looksLikeGameId(value)),
          (value) => {
            expect(isValidGameId(value)).toBe(false);
          }
        ),
        propertyRunConfig
      );
    });

    it('agrees with the independent check on completely arbitrary input', () => {
      fc.assert(
        fc.property(anyInputArb, (value) => {
          expect(isValidGameId(value)).toBe(looksLikeGameId(value));
        }),
        propertyRunConfig
      );
    });
  });

  describe('totality: no input produces a non-game-id result', () => {
    it('getMirrorGameId returns null or a genuine game id, never anything else', () => {
      fc.assert(
        fc.property(anyInputArb, (input) => {
          const result = getMirrorGameId(input);
          if (result !== null) {
            expect(looksLikeGameId(result)).toBe(true);
            expect(result.trim()).toBe(result);
          }
        }),
        propertyRunConfig
      );
    });

    it('normalizeMirrorUrl returns null or a canonical wos.gg URL, never anything else', () => {
      fc.assert(
        fc.property(anyInputArb, (input) => {
          const result = normalizeMirrorUrl(input);
          if (result !== null) {
            expect(result.startsWith(WOS_MIRROR_BASE)).toBe(true);
            expect(looksLikeGameId(result.slice(WOS_MIRROR_BASE.length))).toBe(true);
          }
        }),
        propertyRunConfig
      );
    });

    it('never returns a game id for a host other than wos.gg', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(
            'example.com',
            'evil-wos.gg',
            'wos.gg.attacker.test',
            'wosplus.com',
            'wos.gg.co'
          ),
          (gameId, host) => {
            expect(getMirrorGameId(`https://${host}/r/${gameId}`)).toBeNull();
          }
        ),
        propertyRunConfig
      );
    });
  });
});
