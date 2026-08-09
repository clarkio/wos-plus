// Shared helpers for validating board slot data before it is written to the
// database. Every slot on a Words on Stream board is a distinct word, so a
// board whose slots contain the same word more than once is corrupted data
// (issue #119) and must never be inserted as-is.

import { canFormWord } from '../scripts/wos-words';

/**
 * The `slots` column comes back from the database as a JSON string rather
 * than a parsed array, so redundancy checks against stored boards must parse
 * it first — otherwise every stored board looks clean and the self-healing
 * update never runs. Returns null when the value can't be read as an array.
 */
export function coerceSlots(slots: unknown): unknown[] | null {
  if (Array.isArray(slots)) {
    return slots;
  }
  if (typeof slots === 'string') {
    try {
      const parsed = JSON.parse(slots);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns the words that appear in more than one slot (case-insensitive),
 * deduplicated. An empty array means the board has no redundant words.
 * Accepts either a slots array or the JSON string stored in the database.
 * Slots without a usable `word` string are ignored so this can safely run
 * against unvalidated request bodies.
 */
export function findRedundantWords(slots: unknown): string[] {
  const slotsArray = coerceSlots(slots);
  if (!slotsArray) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const slot of slotsArray) {
    const word = slot && typeof slot === 'object' ? (slot as { word?: unknown }).word : undefined;
    if (typeof word !== 'string' || word.length === 0) {
      continue;
    }
    const key = word.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([word]) => word);
}

export function hasRedundantWords(slots: unknown): boolean {
  return findRedundantWords(slots).length > 0;
}

/**
 * Valid letters for a board are exactly the letters of its big word (see
 * specs/boards.md § Repairing a board that was stored badly, issue #163): the
 * big word uses every real letter on the board, so a slot word containing a
 * letter the big word lacks — or more of a letter than the big word has —
 * could never have been played there, and its presence means the stored
 * board is wrong.
 *
 * Returns the offending words (lower-cased, deduplicated). An empty array
 * means every word on the board is spellable from the big word. Reuses
 * `canFormWord`'s letter-frequency check from wos-words.ts rather than
 * re-implementing it. Slots without a usable `word` string are ignored, and a
 * missing or empty `bigWord` yields no findings, since there is then nothing
 * to check against.
 */
export function findInvalidWords(slots: unknown, bigWord: string): string[] {
  const slotsArray = coerceSlots(slots);
  if (!slotsArray || typeof bigWord !== 'string' || bigWord.length === 0) {
    return [];
  }

  const bigWordLetters = Array.from(bigWord.toLowerCase());
  const invalid = new Set<string>();
  for (const slotEntry of slotsArray) {
    const word = slotEntry && typeof slotEntry === 'object' ? (slotEntry as { word?: unknown }).word : undefined;
    if (typeof word !== 'string' || word.length === 0) {
      continue;
    }
    if (!canFormWord(word, bigWordLetters)) {
      invalid.add(word.toLowerCase());
    }
  }

  return [...invalid];
}

export function hasInvalidWords(slots: unknown, bigWord: string): boolean {
  return findInvalidWords(slots, bigWord).length > 0;
}

/**
 * True when a single slot has the shape a board write needs: an object with
 * a `letters` array and a non-empty `word` string. Shared by the repair path
 * (PUT /api/boards/[id]) and the save path (POST /api/boards, issue #162) so
 * the two write paths cannot disagree about what a valid slot is.
 */
export function isWellFormedSlot(slot: unknown): boolean {
  return (
    !!slot &&
    typeof slot === 'object' &&
    Array.isArray((slot as { letters?: unknown }).letters) &&
    typeof (slot as { word?: unknown }).word === 'string' &&
    (slot as { word: string }).word.length > 0
  );
}

/**
 * Validates and normalizes a board id against the same rules
 * specs/boards.md § Naming a board enforces on lookup (`validateBoardId` in
 * `[id].ts`): letters only, 4-12 characters once whitespace is stripped and
 * the value is upper-cased. Shared with the save path (POST /api/boards,
 * issue #162) so a board can no longer be filed under a name the lookup path
 * will then always reject.
 */
export function validateBoardName(id: unknown): { cleanId: string } | { error: string } {
  if (typeof id !== 'string' || id.length === 0) {
    return { error: 'Board ID is required' };
  }

  const cleanId = id.replace(/\s+/g, '').toUpperCase();

  if (!/^[A-Z]+$/.test(cleanId)) {
    return { error: 'Invalid board ID format. Only letters are allowed.' };
  }

  if (cleanId.length < 4 || cleanId.length > 12) {
    return { error: 'Invalid board ID length. Must be between 4 and 12 characters.' };
  }

  return { cleanId };
}

// Words on Stream supports three word languages. The game's socket events
// carry the language as a numeric id (e.g. on the "Game Connected" payload);
// the official wos.gg client resolves that id through its /api/language?id=N
// endpoint, which returns these codes: 1 → 'pt', 2 → 'en', 4 → 'fr'.
export const WOS_LANGUAGE_ID_TO_CODE: Readonly<Record<number, string>> = {
  1: 'pt',
  2: 'en',
  4: 'fr',
};

const SUPPORTED_LANGUAGE_CODES = new Set(Object.values(WOS_LANGUAGE_ID_TO_CODE));

/**
 * Maps the numeric language id from a WoS socket event to its two-letter
 * language code. Returns null for unknown ids (including future languages WoS
 * may add) so callers can fall back to their current language instead of
 * storing a bogus code.
 */
export function wosLanguageIdToCode(languageId: unknown): string | null {
  if (typeof languageId !== 'number' || !Number.isInteger(languageId)) {
    return null;
  }
  return WOS_LANGUAGE_ID_TO_CODE[languageId] ?? null;
}

/**
 * Normalizes a language code for storage on a board (lowercase, trimmed).
 * Returns null when the value isn't one of the languages Words on Stream
 * supports ('en', 'pt', 'fr') so callers can simply omit it — the language is
 * informational metadata and must never block a board from saving.
 */
export function normalizeLanguageCode(code: unknown): string | null {
  if (typeof code !== 'string') {
    return null;
  }

  const cleanCode = code.trim().toLowerCase();
  return SUPPORTED_LANGUAGE_CODES.has(cleanCode) ? cleanCode : null;
}

/**
 * Strips the formatting streamers plausibly type a Twitch channel name with —
 * a leading '#', surrounding whitespace, mixed case — without judging whether
 * the result is a valid Twitch username. Shared by `normalizeTwitchChannel`
 * (below) and the channel-stats read path so both sides of a name written
 * either way resolve to the same channel (#164).
 */
export function cleanTwitchChannel(channel: string): string {
  return channel.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Normalizes a Twitch channel name for storage on a board (lowercase, no
 * leading '#'). Returns null when the value isn't a valid Twitch username
 * (letters, digits, underscores, max 50 chars) so callers can simply omit it —
 * the channel is informational and must never block a board from saving.
 */
export function normalizeTwitchChannel(channel: unknown): string | null {
  if (typeof channel !== 'string') {
    return null;
  }

  const cleanChannel = cleanTwitchChannel(channel);
  if (!/^[a-z0-9_]{1,50}$/.test(cleanChannel)) {
    return null;
  }

  return cleanChannel;
}
