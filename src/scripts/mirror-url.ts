/**
 * Validation + normalization for Words on Stream mirror URLs.
 *
 * A valid mirror URL points at the official WoS mirror host and a specific game
 * room:
 *
 *   https://wos.gg/r/<gameId>
 *
 * where `<gameId>` is the unique room id from Words on Stream (a UUID), e.g.
 *
 *   https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6
 *
 * Anything else — other hosts (including other wosplus.com pages), other paths,
 * extra path segments, non-https schemes — is rejected. The embedded board
 * iframe is driven directly from this value, so without these guardrails a user
 * could point it at an arbitrary page and produce a broken picture-in-picture
 * style view instead of the real WoS mirror.
 */

/** The only host a mirror URL is ever allowed to reference. */
export const WOS_MIRROR_HOST = 'wos.gg';

/** Canonical prefix every normalized mirror URL starts with. */
export const WOS_MIRROR_BASE = `https://${WOS_MIRROR_HOST}/r/`;

/**
 * Words on Stream room ids are UUIDs (e.g. the `r/` segment of a mirror link).
 * Matching the UUID shape keeps the iframe locked to real game rooms.
 */
const GAME_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid WoS game id. */
export function isValidGameId(value: string): boolean {
  return GAME_ID_PATTERN.test(value.trim());
}

/**
 * Extract the WoS game id from raw user input.
 *
 * Accepts either a full canonical mirror URL (`https://wos.gg/r/<id>`) or a bare
 * game id. Returns `null` when the input is not a valid WoS mirror reference.
 */
export function getMirrorGameId(input: string): string | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return null;
  }

  // Bare game id pasted on its own (no scheme / path).
  if (isValidGameId(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Must be the official mirror host, served over https, on the /r/<id> path.
  if (url.protocol !== 'https:') {
    return null;
  }
  if (url.hostname.toLowerCase() !== WOS_MIRROR_HOST) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean); // ['r', '<id>']
  if (segments.length !== 2 || segments[0] !== 'r') {
    return null;
  }

  return isValidGameId(segments[1]) ? segments[1] : null;
}

/**
 * Normalize raw user input to the canonical mirror URL, or `null` when the
 * input is not a valid WoS mirror reference.
 */
export function normalizeMirrorUrl(input: string): string | null {
  const gameId = getMirrorGameId(input);
  return gameId ? `${WOS_MIRROR_BASE}${gameId}` : null;
}
