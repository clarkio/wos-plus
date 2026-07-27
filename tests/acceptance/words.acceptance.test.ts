// @vitest-environment node
/**
 * ============================================================================
 * Acceptance tests for the shared word list — `/api/words`
 * ============================================================================
 *
 * Spec: [specs/words.md](../../specs/words.md)
 *
 * Every `describe` below names the spec section it implements, so the mapping
 * from approved scenario to executable assertion is mechanical.
 *
 * ---------------------------------------------------------------------------
 * What this route is, and what it is not
 * ---------------------------------------------------------------------------
 *
 * `/api/words` is the **read** half of the shared word list: it pages the whole
 * `words` table out of Supabase and hands it to a view at start-up. The
 * consuming half — trimming, case-folding, "do I know this word?" — lives in
 * `src/scripts/wos-words.ts` and is covered by `tests/unit/wos-words.test.ts`.
 * Where a spec scenario spans both halves, the comment says so and names the
 * other half, rather than this file quietly asserting only the part it can see.
 *
 * The route exports **`GET` and `OPTIONS` only**. See the
 * "Adding a newly seen word" describe below for the write half, which the spec
 * marks ❓ Unconfirmed and which has no implementation here at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as wordsRoute from '../../src/pages/api/words';
import { GET, OPTIONS } from '../../src/pages/api/words';
import { invokeRoute, readJson, responseHeaders } from './api-harness';
import {
  server,
  setupNetworkMocking,
  supabaseFailure,
  supabaseSuccess,
  unhandledNetworkRequests,
} from './network-mock';

setupNetworkMocking();

/** The page size `src/pages/api/words.ts` pages the `words` table with. */
const PAGE_SIZE = 1000;

/** Shapes a list of words as PostgREST rows of the column the route selects. */
function rows(words: readonly string[]): { normalized_word: string }[] {
  return words.map((word) => ({ normalized_word: word }));
}

/** A batch that exactly fills one page, so the route asks for another. */
function fullPage(prefix: string): string[] {
  return Array.from({ length: PAGE_SIZE }, (_, index) => `${prefix}${index}`);
}

/**
 * Records the `?offset=…&limit=…` of each outgoing page request. `.range(from,
 * to)` in postgrest-js sets exactly those two params, so this is the paging the
 * route actually performed rather than a re-derivation of it.
 */
function pageRecorder(): { seen: string[]; onRequest: (request: Request) => void } {
  const seen: string[] = [];
  return {
    seen,
    onRequest(request: Request) {
      const params = new URL(request.url).searchParams;
      seen.push(`offset=${params.get('offset')}&limit=${params.get('limit')}`);
    },
  };
}

/**
 * Silences the route's `console.error` for failure scenarios. The route is
 * *supposed* to log there, so the log is expected output, not a signal — but
 * left unmuted it buries the actual test results.
 */
function silenceRouteLogging(): void {
  vi.spyOn(console, 'error').mockImplementation(() => { /* expected */ });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('specs/words.md — Loading the shared word list', () => {
  describe('Scenario: the word list loads when a view opens', () => {
    // Given a player or streamer opens their WoS+ view
    // When the view starts up
    // Then WoS+ loads the whole shared word list, however many words it holds,
    //      and reports how many words it knows

    it('serves every word the shared list holds', async () => {
      server.use(supabaseSuccess('words', rows(['caution', 'action', 'trilby'])));

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(response.status).toBe(200);
      expect(await readJson<string[]>(response)).toEqual(['caution', 'action', 'trilby']);
    });

    it('serves the list in a form a view can read', async () => {
      server.use(supabaseSuccess('words', rows(['caution'])));

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(responseHeaders(response)['content-type']).toBe('application/json');
      // A bare array, so the view can count it directly — "reports how many
      // words it knows" is the length of what comes back, not a wrapper field.
      expect(Array.isArray(await readJson(response))).toBe(true);
    });

    it('asks the store only for the stored word text', async () => {
      const recorder = pageRecorder();
      let selected: string | null = null;

      server.use(supabaseSuccess('words', rows(['caution']), {
        onRequest(request) {
          recorder.onRequest(request);
          selected = new URL(request.url).searchParams.get('select');
        },
      }));

      await invokeRoute(GET, { url: '/api/words' });

      expect(selected).toBe('normalized_word');
      expect(recorder.seen).toEqual([`offset=0&limit=${PAGE_SIZE}`]);
    });
  });

  describe('Scenario: the word list is very large', () => {
    // Given the shared word list holds far more words than can be sent in one go
    // When WoS+ loads it
    // Then every word is loaded — the fact that it arrived in several batches
    //      is invisible to the player

    it('loads every word however many batches it takes', async () => {
      const first = fullPage('first-');
      const second = fullPage('second-');
      const last = ['caution', 'action', 'trilby'];
      const recorder = pageRecorder();

      server.use(
        supabaseSuccess('words', rows(first), { once: true, onRequest: recorder.onRequest }),
        supabaseSuccess('words', rows(second), { once: true, onRequest: recorder.onRequest }),
        supabaseSuccess('words', rows(last), { once: true, onRequest: recorder.onRequest }),
      );

      const response = await invokeRoute(GET, { url: '/api/words' });
      const body = await readJson<string[]>(response);

      expect(response.status).toBe(200);
      // Invisible to the player: one flat list, in store order, no batch seams.
      expect(body).toHaveLength(first.length + second.length + last.length);
      expect(body).toEqual([...first, ...second, ...last]);
    });

    it('walks the list one page at a time until a short page ends it', async () => {
      const recorder = pageRecorder();

      server.use(
        supabaseSuccess('words', rows(fullPage('a-')), { once: true, onRequest: recorder.onRequest }),
        supabaseSuccess('words', rows(fullPage('b-')), { once: true, onRequest: recorder.onRequest }),
        supabaseSuccess('words', rows(['tail']), { once: true, onRequest: recorder.onRequest }),
      );

      await invokeRoute(GET, { url: '/api/words' });

      expect(recorder.seen).toEqual([
        `offset=0&limit=${PAGE_SIZE}`,
        `offset=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        `offset=${PAGE_SIZE * 2}&limit=${PAGE_SIZE}`,
      ]);
    });

    it('keeps asking when the last batch exactly fills a page, then stops', async () => {
      // The off-by-one that matters: a store holding exactly PAGE_SIZE words
      // returns a full page, which is indistinguishable from "there is more".
      // The route must ask once more, get nothing, and stop — not truncate, and
      // not loop. Only two handlers are registered, so a third request would be
      // refused by the harness catch-all and fail this test.
      const exact = fullPage('exact-');
      const recorder = pageRecorder();

      server.use(
        supabaseSuccess('words', rows(exact), { once: true, onRequest: recorder.onRequest }),
        supabaseSuccess('words', [], { once: true, onRequest: recorder.onRequest }),
      );

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(await readJson<string[]>(response)).toEqual(exact);
      expect(recorder.seen).toEqual([
        `offset=0&limit=${PAGE_SIZE}`,
        `offset=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
      ]);
    });
  });

  describe('Scenario: the word list is empty', () => {
    // Given the shared word list holds no words
    // When WoS+ loads it
    // Then WoS+ knows no words — this is a normal answer, not a failure

    it('answers with no words, as an ordinary answer', async () => {
      server.use(supabaseSuccess('words', []));

      const response = await invokeRoute(GET, { url: '/api/words' });

      // "not a failure": a 2xx carrying an empty list, never an error status.
      expect(response.status).toBe(200);
      expect(await readJson<string[]>(response)).toEqual([]);
    });

    it('asks the store only once when the first page is empty', async () => {
      const recorder = pageRecorder();
      server.use(supabaseSuccess('words', [], { once: true, onRequest: recorder.onRequest }));

      await invokeRoute(GET, { url: '/api/words' });

      expect(recorder.seen).toEqual([`offset=0&limit=${PAGE_SIZE}`]);
    });
  });

  describe('Scenario: the word list cannot be reached', () => {
    // Given the shared word list is unavailable
    // When WoS+ tries to load it
    // Then WoS+ carries on running with no words known
    //
    // The *view's* half of that promise — swallowing the failure and carrying
    // on with an empty dictionary — lives in `loadWordsFromDb` in
    // `src/scripts/wos-words.ts` and is covered by `tests/unit/wos-words.test.ts`.
    // The route's half is narrower but load-bearing: it must make the failure
    // *distinguishable* from an empty list. If it answered 200 with `[]` the
    // view would record "the shared list is empty" as fact, which is a
    // different and wrong state.

    it('reports the failure instead of passing an empty list off as the answer', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('words', {
        code: '42P01',
        message: 'relation "words" does not exist',
      }));

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(response.status).toBe(500);
      const body = await readJson<{ error?: string }>(response);
      expect(typeof body.error).toBe('string');
      expect(body.error).toContain('relation "words" does not exist');
      // The failure must not be mistakable for "the list is empty".
      expect(body).not.toEqual([]);
    });

    it('reports a failure that strikes partway through paging, rather than a partial list', async () => {
      // A truncated list is worse than no list: the view would treat words it
      // never received as unknown, and report them as missed at end of level.
      silenceRouteLogging();
      server.use(
        supabaseSuccess('words', rows(fullPage('page-one-')), { once: true }),
        supabaseFailure('words', { message: 'connection reset by peer' }, { once: true, status: 500 }),
      );

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.stringContaining('connection reset by peer'),
      });
    });

    it('reports a failure when the store credentials are missing, without reaching out', async () => {
      silenceRouteLogging();

      const response = await invokeRoute(GET, {
        url: '/api/words',
        workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.any(String),
      });
      // No handler was registered: proving nothing was attempted also proves
      // the route did not fall back to some other host.
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: extra spacing around a stored word', () => {
    // Given the shared word list holds a word with stray spaces around it
    // When WoS+ loads the list
    // Then the word is known without the spaces
    //
    // The trim is the *view's* job — `loadWordsFromDb` in
    // `src/scripts/wos-words.ts` maps `word.trim()` over the response, and
    // `tests/unit/wos-words.test.ts` covers that this makes the word known
    // without its spaces. The route's contribution is to be faithful: it hands
    // over exactly what is stored, so it neither hides the stray spacing from
    // the view nor invents a second, competing normalisation step.

    it('hands over the stored text verbatim, leaving normalisation to the view', async () => {
      server.use(supabaseSuccess('words', rows(['  caution  ', 'ACTION', 'trilby'])));

      const response = await invokeRoute(GET, { url: '/api/words' });

      expect(await readJson<string[]>(response)).toEqual(['  caution  ', 'ACTION', 'trilby']);
    });
  });
});

describe('specs/words.md — Adding a newly seen word (❓ Unconfirmed — not a contract)', () => {
  /**
   * The spec marks this **entire section** ❓ Unconfirmed: it describes a
   * capability that exists but that nothing in a live level uses. Per
   * `specs/README.md`, an unconfirmed scenario "is not yet part of the
   * contract", so none of its three scenarios is asserted as passing behaviour
   * here. They are `it.todo` below, each naming the open question.
   *
   * What is true today, and is worth stating because it is what makes those
   * scenarios untestable:
   *
   * - `/api/words` exports `GET` and `OPTIONS` only. A `POST` handler exists in
   *   `src/pages/api/words.ts` but is entirely commented out, and there is no
   *   `PATCH` handler at all.
   * - The one client-side add path, `updateWordsDb` in
   *   `src/scripts/wos-words.ts`, does not call this route: it `PATCH`es the
   *   external URL `https://clarkio.com/wos-dictionary`. It has **no callers
   *   anywhere in `src/`**.
   *
   * So the architecture notes' claim that words are auto-added on correct
   * guesses is not wired up, and the add path that does exist bypasses this
   * route. Nothing below asserts anything about gameplay wiring.
   */

  // Canary. If someone adds a write handler to `/api/words`, this test fails
  // and the `it.todo`s underneath it must be answered rather than left behind.
  it('serves reads only — no way to add a word exists on this route today', async () => {
    const exportedHandlers = Object.keys(wordsRoute)
      .filter((name) => /^[A-Z]+$/.test(name))
      .sort();

    expect(exportedHandlers).toEqual(['GET', 'OPTIONS']);

    // And the route says so to any client that asks.
    const response = await invokeRoute(OPTIONS, {
      method: 'OPTIONS',
      url: '/api/words',
      workerEnv: { CORS_ALLOWED_ORIGINS: 'https://wosplus.com' },
    });
    expect(responseHeaders(response)['access-control-allow-methods']).toBe('GET, OPTIONS');
  });

  it.todo(
    '❓ Unconfirmed: a word WoS+ already knows is not sent again — ' +
    'open question: should adding words be wired up at all, or retired? ' +
    'No add endpoint exists on /api/words (specs/words.md § Adding a newly seen word)',
  );

  it.todo(
    '❓ Unconfirmed: a new word becomes known immediately — ' +
    'open question: if adding is kept, should it go through /api/words rather than ' +
    'the external clarkio.com/wos-dictionary URL that updateWordsDb uses today?',
  );

  it.todo(
    '❓ Unconfirmed: adding a word fails and the word is not treated as known — ' +
    'open question: unreachable until an add endpoint exists to fail',
  );
});

describe('/api/words — transport concerns (no spec section; see task owning src/lib/cors.ts)', () => {
  /**
   * CORS is not described in `specs/words.md`, or anywhere in `specs/` — it is
   * a transport detail rather than game behaviour. These tests therefore only
   * pin down how *this route* wires itself to `src/lib/cors.ts`; the helper's
   * own behaviour belongs to whoever owns `cors.ts`.
   */

  it('answers a preflight with no body', async () => {
    const response = await invokeRoute(OPTIONS, {
      method: 'OPTIONS',
      url: '/api/words',
      headers: { origin: 'https://wosplus.com' },
      workerEnv: { CORS_ALLOWED_ORIGINS: 'https://wos-plus.pages.dev,https://wosplus.com' },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': 'https://wosplus.com',
      'access-control-allow-methods': 'GET, OPTIONS',
    });
  });

  it('carries the callers own origin on a word-list response when it is allowed', async () => {
    server.use(supabaseSuccess('words', rows(['caution'])));

    const response = await invokeRoute(GET, {
      url: '/api/words',
      headers: { origin: 'https://wosplus.com' },
      workerEnv: { CORS_ALLOWED_ORIGINS: 'https://wos-plus.pages.dev,https://wosplus.com' },
    });

    expect(response.status).toBe(200);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('https://wosplus.com');
  });

  it('falls back to the primary configured origin for a caller from elsewhere', async () => {
    server.use(supabaseSuccess('words', rows(['caution'])));

    const response = await invokeRoute(GET, {
      url: '/api/words',
      headers: { origin: 'https://not-allowed.example' },
      workerEnv: { CORS_ALLOWED_ORIGINS: 'https://wos-plus.pages.dev,https://wosplus.com' },
    });

    expect(responseHeaders(response)['access-control-allow-origin']).toBe('https://wos-plus.pages.dev');
  });

  it('still answers the word list when CORS is misconfigured, rather than failing the load', async () => {
    /**
     * ⚠️ DEFECT, in `src/lib/cors.ts` — recorded, deliberately not fixed here.
     *
     * With `CORS_ALLOWED_ORIGINS` unset, `getCorsOrigin` returns
     * `allowedOrigins[0]`, which is `undefined`, and the `Headers` constructor
     * stringifies that to the literal `"undefined"`. Every response from every
     * route that uses the helper then advertises an origin named `undefined`.
     *
     * It is asserted here as *current behaviour under protest*, not as the
     * contract: the fix belongs in `cors.ts`, which another task owns, and
     * duplicating it here would collide with that work. When that fix lands,
     * this expectation should change with it.
     *
     * What genuinely is this route's contract — and is asserted as such — is
     * that a CORS misconfiguration must not cost the channel its word list.
     */
    server.use(supabaseSuccess('words', rows(['caution', 'action'])));

    const response = await invokeRoute(GET, {
      url: '/api/words',
      headers: { origin: 'https://wosplus.com' },
      workerEnv: { CORS_ALLOWED_ORIGINS: undefined },
    });

    expect(response.status).toBe(200);
    expect(await readJson<string[]>(response)).toEqual(['caution', 'action']);

    // The defect itself, pinned so the fix is a visible, deliberate change.
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('undefined');
  });
});
