import { describe, it, expect } from 'vitest';
import {
  isBlockedRequestUrl,
  isKnownExpectedFailureUrl,
} from '../e2e/e2e-harness';

/**
 * Unit coverage for the E2E suite's own network policy (issue #203).
 *
 * The E2E suite claims to be hermetic — "zero reliance on real third-party
 * network reachability" (CLAUDE.md §7/§9). That claim is about *policy*, and
 * policy is exactly the thing a browser-driven test cannot check: in a
 * sandbox with no outbound access every host looks blocked whether the
 * harness blocks it or not, so an end-to-end assertion passes for the wrong
 * reason. These tests assert the predicates directly, so they mean the same
 * thing on a developer's machine, in CI, and in an offline sandbox.
 *
 * They live in the unit stream rather than tests/e2e/ because they need no
 * browser and no `wrangler dev` — and because tests/e2e/** is excluded from
 * Vitest (those specs use @playwright/test's own `test`/`expect`).
 */
describe('E2E network policy: blocked hosts', () => {
  it.each([
    ['Google Fonts stylesheet', 'https://fonts.googleapis.com/css2?family=X'],
    ['Google Fonts file', 'https://fonts.gstatic.com/s/x.woff2'],
    ["Twitch's GQL lookup", 'https://gql.twitch.tv/gql'],
    ['the WoS mirror board', 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6'],
  ])('blocks %s', (_label, url) => {
    expect(isBlockedRequestUrl(new URL(url))).toBe(true);
  });

  it('does not block the app under test', () => {
    expect(isBlockedRequestUrl(new URL('http://127.0.0.1:8788/player'))).toBe(false);
    expect(isBlockedRequestUrl(new URL('http://127.0.0.1:8788/api/health'))).toBe(false);
  });

  it('does not block a lookalike host that merely ends with a blocked one', () => {
    // Matched on the parsed hostname rather than a substring of the raw URL,
    // so this must not be treated as Google Fonts.
    expect(
      isBlockedRequestUrl(new URL('https://evil-fonts.googleapis.com.example/x')),
    ).toBe(false);
  });
});

describe('E2E network policy: expected failures', () => {
  it.each([
    ['the WoS mirror board', 'https://wos.gg/r/4fdfc856-0328-4384-a882-8377dcb5a4f6'],
    ['Google Fonts', 'https://fonts.googleapis.com/css2?family=X'],
    ["Twitch's GQL lookup", 'https://gql.twitch.tv/gql'],
    ['the words route', 'http://127.0.0.1:8788/api/words'],
    ['a channel-stats route', 'http://127.0.0.1:8788/api/channel-stats/clarkio'],
  ])('treats a failure of %s as expected', (_label, url) => {
    expect(isKnownExpectedFailureUrl(url)).toBe(true);
  });

  it.each([
    ['an unrelated route', 'http://127.0.0.1:8788/definitely-not-a-real-route'],
    ['a path merely containing a known one', 'http://127.0.0.1:8788/api/words-backup'],
    ['a known path in a query string', 'http://127.0.0.1:8788/?next=/api/words'],
    ['an unparseable url', 'not-a-url'],
  ])('treats a failure of %s as unexpected', (_label, url) => {
    expect(isKnownExpectedFailureUrl(url)).toBe(false);
  });
});
