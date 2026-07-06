/**
 * Validation for user-entered Twitch channel/login names.
 *
 * Twitch usernames are 4-25 characters of letters, numbers, and underscores.
 * `isValidTwitchLoginFormat` rejects obvious typos/garbage synchronously,
 * before any network round trip.
 *
 * `twitchChannelExists` confirms the login actually belongs to a Twitch
 * account. It queries Twitch's own public GQL endpoint (gql.twitch.tv) using
 * the Client-Id Twitch's web client itself uses for unauthenticated, read-only
 * browser requests — the same technique used by many third-party Twitch
 * tools (chat overlays, extensions) since Twitch does not expose Helix (the
 * official API) for anonymous, credential-free lookups.
 */

const TWITCH_LOGIN_PATTERN = /^[a-zA-Z0-9_]{4,25}$/;

/** True when `login` matches Twitch's username shape (4-25 alphanumeric/underscore chars). */
export function isValidTwitchLoginFormat(login: string): boolean {
  return TWITCH_LOGIN_PATTERN.test(login.trim());
}

const TWITCH_GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
// Twitch's own public web client id. It identifies unauthenticated requests
// from twitch.tv's frontend and is safe to use client-side for read-only
// lookups like this one.
const TWITCH_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

// Bounds how long a caller (e.g. the settings dialog's Save button) can be
// stuck waiting on this unofficial endpoint. Without it a hung connection
// would leave the UI showing "Saving..." indefinitely.
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Checks whether a Twitch account with the given login exists.
 *
 * Returns `true`/`false` when Twitch answers definitively, or `null` when the
 * check couldn't be completed (network error, timeout, unexpected response).
 * Callers should treat `null` as "unknown" rather than "invalid" so a
 * transient outage of this unofficial endpoint doesn't block users from
 * saving their settings.
 */
export async function twitchChannelExists(
  login: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<boolean | null> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  // Combine the caller's signal (if any) with our own timeout so either one
  // can abort the request.
  opts.signal?.addEventListener('abort', () => timeoutController.abort());

  try {
    const response = await fetch(TWITCH_GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': TWITCH_PUBLIC_CLIENT_ID,
      },
      body: JSON.stringify({
        query: 'query($login: String!) { user(login: $login) { id } }',
        variables: { login },
      }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      return null;
    }

    const json: any = await response.json();
    if (json?.errors) {
      return null;
    }

    return !!json?.data?.user;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
