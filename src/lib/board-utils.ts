// Shared helpers for validating board slot data before it is written to the
// database. Every slot on a Words on Stream board is a distinct word, so a
// board whose slots contain the same word more than once is corrupted data
// (issue #119) and must never be inserted as-is.

/**
 * Returns the words that appear in more than one slot (case-insensitive),
 * deduplicated. An empty array means the board has no redundant words.
 * Slots without a usable `word` string are ignored so this can safely run
 * against unvalidated request bodies.
 */
export function findRedundantWords(slots: unknown): string[] {
  if (!Array.isArray(slots)) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const slot of slots) {
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
 * Normalizes a Twitch channel name for storage on a board (lowercase, no
 * leading '#'). Returns null when the value isn't a valid Twitch username
 * (letters, digits, underscores, max 50 chars) so callers can simply omit it —
 * the channel is informational and must never block a board from saving.
 */
export function normalizeTwitchChannel(channel: unknown): string | null {
  if (typeof channel !== 'string') {
    return null;
  }

  const cleanChannel = channel.trim().replace(/^#/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,50}$/.test(cleanChannel)) {
    return null;
  }

  return cleanChannel;
}
