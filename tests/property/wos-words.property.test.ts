import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { propertyRunConfig } from './fc-config';

/**
 * Property-based tests for the word-matching engine (issue #150).
 *
 * Example-based tests assert on hand-picked inputs, which an implementation can
 * satisfy without being correct — and which an agent can overfit to. These
 * assert *invariants* over generated input instead, which is what catches the
 * off-by-one / inverted-condition / boundary mistakes example tests miss.
 *
 * `findWosWordsByLetters` is module-private; it is reached through
 * `findAllMissingWords`, the only path the application uses.
 */

type WosWordsModule = typeof import('@scripts/wos-words');

/** Letters chosen so many short words are formable from small subsets. */
const LETTER_POOL = 'aeiorstn';

/**
 * A fixed dictionary. Deliberately includes words needing doubled letters
 * ('tree', 'treat', 'sees') so the letter-frequency accounting is exercised
 * rather than mere letter-membership.
 */
const DICTIONARY = [
  'rate', 'tear', 'tare', 'star', 'rats', 'tars', 'oats', 'oars', 'soar',
  'note', 'tone', 'tore', 'rote', 'stone', 'stoner', 'tenor', 'snore',
  'tree', 'treat', 'sees', 'irate', 'ratio', 'ration', 'nitro', 'intro',
  'rain', 'train', 'strain', 'saint', 'stain', 'satin', 'antis',
];

/**
 * Independent re-implementation of "can this word be built from these letters",
 * written from the rules rather than from the production helper. Importing the
 * production check here would make every property below tautological.
 */
function isBuildableFrom(word: string, letters: string): boolean {
  const available = new Map<string, number>();
  for (const ch of letters.toLowerCase()) {
    available.set(ch, (available.get(ch) ?? 0) + 1);
  }
  for (const ch of word.toLowerCase()) {
    const remaining = available.get(ch) ?? 0;
    if (remaining === 0) return false;
    available.set(ch, remaining - 1);
  }
  return true;
}

/** Loads a fresh module instance with DICTIONARY installed via the real load path. */
async function loadModuleWithDictionary(): Promise<WosWordsModule> {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => DICTIONARY,
  }));
  vi.spyOn(console, 'log').mockImplementation(() => { });
  vi.spyOn(console, 'error').mockImplementation(() => { });

  const wosWords = await import('@scripts/wos-words');
  await wosWords.loadWordsFromDb();
  return wosWords;
}

/** Arbitrary for a bag of letters drawn from the pool. */
const lettersArb = fc
  .array(fc.constantFrom(...LETTER_POOL.split('')), { minLength: 4, maxLength: 8 })
  .map(chars => chars.join(''));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('findAllMissingWords / findWosWordsByLetters properties', () => {
  it('only returns words that can actually be built from the given letters', async () => {
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(lettersArb, fc.integer({ min: 4, max: 6 }), async (letters, minLength) => {
        const missing = wosWords.findAllMissingWords([], letters, minLength);
        for (const word of missing) {
          expect(isBuildableFrom(word, letters)).toBe(true);
        }
      }),
      propertyRunConfig,
    );
  });

  it('only returns words that are in the dictionary', async () => {
    const wosWords = await loadModuleWithDictionary();
    const known = new Set(DICTIONARY.map(w => w.toLowerCase()));

    await fc.assert(
      fc.asyncProperty(lettersArb, async letters => {
        for (const word of wosWords.findAllMissingWords([], letters, 4)) {
          expect(known.has(word.toLowerCase())).toBe(true);
        }
      }),
      propertyRunConfig,
    );
  });

  it('is invariant under permutation of the input letters', async () => {
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(lettersArb, async letters => {
        // Letters come from an ASCII pool by construction; no surrogate pairs.
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        const shuffled = [...letters].reverse().join('');
        const a = [...wosWords.findAllMissingWords([], letters, 4)].sort();
        const b = [...wosWords.findAllMissingWords([], shuffled, 4)].sort();
        expect(b).toEqual(a);
      }),
      propertyRunConfig,
    );
  });

  it('never loses a word when another letter is added (monotonicity)', async () => {
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(
        lettersArb,
        fc.constantFrom(...LETTER_POOL.split('')),
        async (letters, extra) => {
          const before = wosWords.findAllMissingWords([], letters, 4);
          const after = new Set(wosWords.findAllMissingWords([], letters + extra, 4));
          for (const word of before) {
            expect(after.has(word)).toBe(true);
          }
        },
      ),
      propertyRunConfig,
    );
  });

  it('never returns a word shorter than minLength', async () => {
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(lettersArb, fc.integer({ min: 4, max: 8 }), async (letters, minLength) => {
        for (const word of wosWords.findAllMissingWords([], letters, minLength)) {
          expect(word.length).toBeGreaterThanOrEqual(minLength);
        }
      }),
      propertyRunConfig,
    );
  });

  it('never returns a word that is already known', async () => {
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(
        lettersArb,
        fc.subarray(DICTIONARY, { maxLength: 5 }),
        async (letters, known) => {
          const missing = wosWords.findAllMissingWords(known, letters, 4);
          for (const word of known) {
            expect(missing).not.toContain(word.toLowerCase());
          }
        },
      ),
      propertyRunConfig,
    );
  });

  it('never returns a known word that carries the * missed-word marker', async () => {
    // The UI appends '*' to missed words and pushes them back into the same
    // list that is later passed as knownWords, so the marker has to be stripped
    // before comparison or the word is re-reported on every subsequent run.
    const wosWords = await loadModuleWithDictionary();

    await fc.assert(
      fc.asyncProperty(
        lettersArb,
        fc.subarray(DICTIONARY, { maxLength: 5 }),
        async (letters, known) => {
          const marked = known.map(w => `${w}*`);
          const missing = wosWords.findAllMissingWords(marked, letters, 4);
          for (const word of known) {
            expect(missing).not.toContain(word.toLowerCase());
          }
        },
      ),
      propertyRunConfig,
    );
  });
});
