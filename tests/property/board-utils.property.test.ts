import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  coerceSlots,
  normalizeLanguageCode,
  normalizeTwitchChannel,
  WOS_LANGUAGE_ID_TO_CODE,
} from '../../src/lib/board-utils';
import { propertyRunConfig } from './fc-config';

/**
 * Property-based tests for the board data normalizers (issue #150, plan phase 4).
 *
 * These functions sit directly on the request path for saving a board, so they
 * see genuinely arbitrary input. The invariants that matter are:
 *
 * - **Idempotence** (`f(f(x)) === f(x)`): the normalizers are also applied to
 *   values that have already been stored, so a normalizer that keeps changing
 *   its own output would let the same logical board be written two ways.
 * - **Output alphabet**: whatever comes back must be safe to store, so the
 *   non-null output has to match the character class the doc comment promises —
 *   not merely "the examples we tried came out clean".
 * - **Totality**: none of these may throw, whatever they are handed. They are
 *   documented as never blocking a board from saving, and a thrown TypeError on
 *   a weird payload would do exactly that.
 */

/** The alphabet `normalizeTwitchChannel` promises for its non-null output. */
const TWITCH_CHANNEL_OUTPUT = /^[a-z0-9_]{1,50}$/;

/** The only language codes `normalizeLanguageCode` may ever return. */
const SUPPORTED_LANGUAGE_CODES = Object.values(WOS_LANGUAGE_ID_TO_CODE);

const CHANNEL_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-#. \t\n'.split('');

/** Strings that look like something a user would actually type as a channel. */
const channelishArb = fc
  .array(fc.constantFrom(...CHANNEL_CHARS), { maxLength: 60 })
  .map((chars) => chars.join(''));

/**
 * Names straddling the documented 50-character limit. Random strings almost
 * never land exactly on a boundary, so the boundary gets its own generator —
 * an off-by-one in `{1,50}` is precisely the kind of mistake this suite exists
 * to catch.
 */
const boundaryLengthChannelArb = fc
  .integer({ min: 45, max: 55 })
  .chain((length) =>
    fc.array(fc.constantFrom(...'abcxyz019_'.split('')), {
      minLength: length,
      maxLength: length,
    })
  )
  .map((chars) => chars.join(''));

/** A '#'-prefixed channel, which is how Twitch itself names a chat room. */
const hashPrefixedChannelArb = fc
  .array(fc.constantFrom(...'abcdefgXYZ019_'.split('')), { minLength: 1, maxLength: 25 })
  .map((chars) => `#${chars.join('')}`);

const anyChannelInputArb = fc.oneof(
  { weight: 4, arbitrary: channelishArb },
  { weight: 2, arbitrary: hashPrefixedChannelArb },
  { weight: 2, arbitrary: boundaryLengthChannelArb },
  { weight: 2, arbitrary: fc.string({ maxLength: 60 }) },
  { weight: 1, arbitrary: fc.anything() },
);

const anyLanguageInputArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('en', 'pt', 'fr') },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'EN',
      'Pt',
      ' fr ',
      '\tEN\n',
      'en-US',
      'de',
      'eng',
      '',
      '  '
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 8 }) },
  { weight: 1, arbitrary: fc.anything() },
);

const slotLikeArb = fc.record(
  {
    word: fc.oneof(fc.string({ maxLength: 8 }), fc.constant(undefined), fc.integer()),
    // fast-check 4 removed fc.char(); a length-1 string is the replacement.
    letters: fc.array(fc.string({ minLength: 1, maxLength: 1 }), { maxLength: 6 }),
    hitMax: fc.boolean(),
  },
  { requiredKeys: [] }
);

const anySlotsInputArb = fc.oneof(
  { weight: 3, arbitrary: fc.array(slotLikeArb, { maxLength: 6 }) },
  {
    weight: 3,
    arbitrary: fc
      .array(slotLikeArb, { maxLength: 6 })
      .map((slots) => JSON.stringify(slots)),
  },
  { weight: 2, arbitrary: fc.json() },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 2, arbitrary: fc.anything() },
);

describe('board-utils properties', () => {
  describe('normalizeTwitchChannel', () => {
    it('is idempotent: normalizing its own output changes nothing', () => {
      fc.assert(
        fc.property(anyChannelInputArb, (input) => {
          const once = normalizeTwitchChannel(input);
          expect(normalizeTwitchChannel(once)).toBe(once);
        }),
        propertyRunConfig
      );
    });

    it('only ever returns null or a lowercase [a-z0-9_] name of 1..50 characters', () => {
      fc.assert(
        fc.property(anyChannelInputArb, (input) => {
          const result = normalizeTwitchChannel(input);
          if (result !== null) {
            expect(result).toMatch(TWITCH_CHANNEL_OUTPUT);
            expect(result).toBe(result.toLowerCase());
            expect(result.length).toBeLessThanOrEqual(50);
            expect(result.length).toBeGreaterThan(0);
          }
        }),
        propertyRunConfig
      );
    });

    it('never throws, whatever it is handed', () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          expect(() => normalizeTwitchChannel(input)).not.toThrow();
        }),
        propertyRunConfig
      );
    });

    it('accepts a valid name at or below the 50-character limit and rejects it above', () => {
      fc.assert(
        fc.property(boundaryLengthChannelArb, (name) => {
          const accepted = normalizeTwitchChannel(name) !== null;
          expect(accepted).toBe(name.length <= 50);
        }),
        propertyRunConfig
      );
    });

    it('treats a leading "#", surrounding whitespace and casing as noise on an otherwise valid name', () => {
      fc.assert(
        fc.property(
          fc
            .array(fc.constantFrom(...'abcdefgXYZ019_'.split('')), {
              minLength: 1,
              maxLength: 40,
            })
            .map((chars) => chars.join('')),
          fc.constantFrom('', '#'),
          fc.constantFrom('', ' ', '  ', '\t', '\n'),
          (name, hash, space) => {
            expect(normalizeTwitchChannel(`${space}${hash}${name}${space}`)).toBe(
              name.toLowerCase()
            );
          }
        ),
        propertyRunConfig
      );
    });
  });

  describe('normalizeLanguageCode', () => {
    it('is idempotent: normalizing its own output changes nothing', () => {
      fc.assert(
        fc.property(anyLanguageInputArb, (input) => {
          const once = normalizeLanguageCode(input);
          expect(normalizeLanguageCode(once)).toBe(once);
        }),
        propertyRunConfig
      );
    });

    it('only ever returns null or one of the three supported lowercase codes', () => {
      fc.assert(
        fc.property(anyLanguageInputArb, (input) => {
          const result = normalizeLanguageCode(input);
          if (result !== null) {
            expect(SUPPORTED_LANGUAGE_CODES).toContain(result);
            expect(result).toMatch(/^[a-z]{2}$/);
          }
        }),
        propertyRunConfig
      );
    });

    it('never throws, whatever it is handed', () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          expect(() => normalizeLanguageCode(input)).not.toThrow();
        }),
        propertyRunConfig
      );
    });

    it('recovers a supported code through any casing and surrounding whitespace', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SUPPORTED_LANGUAGE_CODES),
          fc.constantFrom('', ' ', '\t', '\n  '),
          fc.boolean(),
          (code, space, upper) => {
            const raw = `${space}${upper ? code.toUpperCase() : code}${space}`;
            expect(normalizeLanguageCode(raw)).toBe(code);
          }
        ),
        propertyRunConfig
      );
    });
  });

  describe('coerceSlots', () => {
    it('never throws, whatever it is handed', () => {
      fc.assert(
        fc.property(anySlotsInputArb, (input) => {
          expect(() => coerceSlots(input)).not.toThrow();
        }),
        propertyRunConfig
      );
    });

    it('always produces a valid shape: null or an array', () => {
      fc.assert(
        fc.property(anySlotsInputArb, (input) => {
          const result = coerceSlots(input);
          expect(result === null || Array.isArray(result)).toBe(true);
        }),
        propertyRunConfig
      );
    });

    it('is idempotent: coercing its own output changes nothing', () => {
      fc.assert(
        fc.property(anySlotsInputArb, (input) => {
          const once = coerceSlots(input);
          expect(coerceSlots(once)).toBe(once);
        }),
        propertyRunConfig
      );
    });

    it('passes arrays through untouched', () => {
      fc.assert(
        fc.property(fc.array(slotLikeArb, { maxLength: 6 }), (slots) => {
          expect(coerceSlots(slots)).toBe(slots);
        }),
        propertyRunConfig
      );
    });

    it('parses the JSON-string form of an array back to an equivalent array', () => {
      fc.assert(
        fc.property(fc.array(slotLikeArb, { maxLength: 6 }), (slots) => {
          const result = coerceSlots(JSON.stringify(slots));
          expect(Array.isArray(result)).toBe(true);
          expect(result).toHaveLength(slots.length);
          expect(result).toEqual(JSON.parse(JSON.stringify(slots)));
        }),
        propertyRunConfig
      );
    });

    it('returns null for any JSON value that is not an array', () => {
      fc.assert(
        fc.property(
          fc.jsonValue().filter((value) => !Array.isArray(value)),
          (value) => {
            expect(coerceSlots(JSON.stringify(value))).toBeNull();
          }
        ),
        propertyRunConfig
      );
    });
  });
});
