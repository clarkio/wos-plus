// @vitest-environment node
/**
 * ============================================================================
 * Acceptance tests for the board archive — `/api/boards` and `/api/boards/[id]`
 * ============================================================================
 *
 * Spec: [specs/boards.md](../../specs/boards.md)
 *
 * Every `describe` below names the spec section it implements, so the mapping
 * from approved scenario to executable assertion is mechanical.
 *
 * ---------------------------------------------------------------------------
 * The two routes, and why the split matters
 * ---------------------------------------------------------------------------
 *
 * - `src/pages/api/boards/index.ts` — `GET` lists the whole archive; `POST`
 *   captures a board for the first time.
 * - `src/pages/api/boards/[id].ts` — `GET` looks one board up; `PUT` repairs a
 *   stored board that was saved with the same word in two slots (issue #119).
 *
 * The board **name** rules in `specs/boards.md § Naming a board` are enforced
 * by `validateBoardId` in `[id].ts` — that is, on *lookup* and *repair*, but
 * **not** on the `POST` save path. The spec records that asymmetry as an open
 * question, and the tests below treat it as one rather than as contract. See
 * the "Open questions" describe at the foot of this file.
 *
 * ---------------------------------------------------------------------------
 * How these tests prove a route did *not* touch the archive
 * ---------------------------------------------------------------------------
 *
 * Several scenarios promise "nothing is saved" or "the archive is never
 * consulted". The harness makes that assertion structural rather than
 * decorative: an HTTP call with no registered handler is answered locally by
 * the catch-all in `network-mock.ts`, recorded, and the recording is asserted
 * empty by its `afterEach`. So a test that registers *no* handler fails loudly
 * the moment the route reaches out, and a test that registers exactly one
 * `once` handler proves exactly one call was made. `unhandledNetworkRequests()`
 * is asserted explicitly where the "never consulted" clause is the point of the
 * scenario.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as boardByIdRoute from '../../src/pages/api/boards/[id]';
import { GET as GET_BOARD, PUT } from '../../src/pages/api/boards/[id]';
import * as boardsRoute from '../../src/pages/api/boards/index';
import { GET as GET_BOARDS, POST } from '../../src/pages/api/boards/index';
import { invokeRoute, readJson, responseHeaders } from './api-harness';
import {
  server,
  setupNetworkMocking,
  supabaseFailure,
  supabaseNoRows,
  supabaseSuccess,
  unhandledNetworkRequests,
} from './network-mock';

setupNetworkMocking();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A slot as the views capture it: the letters on the tile, and the word. */
function slot(word: string): { letters: string[]; word: string } {
  return { letters: Array.from(word), word };
}

/** A sound board: every slot a different word, last slot the big word. */
const CLEAN_SLOTS = [slot('ACT'), slot('COAT'), slot('ACTION'), slot('CAUTION')];

/** A corrupted board: `ACTION` fills two slots. */
const REDUNDANT_SLOTS = [slot('ACTION'), slot('ACTION'), slot('CAUTION')];

/** A stored archive row for `CAUTION`. */
function storedBoard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'CAUTION',
    slots: CLEAN_SLOTS,
    twitch_channel: 'clarkio',
    language_code: 'en',
    ...overrides,
  };
}

/**
 * Captures the outgoing request the real `postgrest-js` client built, so a test
 * can assert on the filter it sent and the body it wrote. Reading a clone
 * leaves the request intact for MSW.
 */
function requestRecorder(): {
  captured: { url?: string; body?: unknown };
  onRequest: (request: Request) => Promise<void>;
} {
  const captured: { url?: string; body?: unknown } = {};
  return {
    captured,
    async onRequest(request: Request) {
      captured.url = request.url;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        captured.body = await request.clone().json();
      }
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

// ===========================================================================
// specs/boards.md § Naming a board
// ===========================================================================

describe('specs/boards.md — Naming a board', () => {
  /**
   * The big word is displayed spaced out (`C A U T I O N`) and typed in any
   * case, and all of those must reach the same archived board. The assertions
   * below check the *filter the route actually sent to the archive*, not just
   * that a 200 came back — otherwise a route that ignored the name entirely
   * would pass.
   */

  describe('Scenario: the big word is written the way it appears on screen', () => {
    // Given a board is filed under the big word `CAUTION`
    // When WoS+ looks the board up as `C A U T I O N`
    // Then the same board is found

    it('finds the board when the name arrives spaced out', async () => {
      const recorder = requestRecorder();
      server.use(supabaseSuccess('boards', storedBoard(), { onRequest: recorder.onRequest }));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/C%20A%20U%20T%20I%20O%20N',
        params: { id: 'C A U T I O N' },
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ id: 'CAUTION' });
      // The spacing was removed before the archive was asked, so the lookup
      // landed on the same row a plain `CAUTION` would have.
      expect(recorder.captured.url).toContain('id=eq.CAUTION');
    });
  });

  describe('Scenario: the big word is written in lower case', () => {
    // Given a board is filed under the big word `CAUTION`
    // When WoS+ looks the board up as `caution`
    // Then the same board is found

    it('finds the board when the name arrives in lower case', async () => {
      const recorder = requestRecorder();
      server.use(supabaseSuccess('boards', storedBoard(), { onRequest: recorder.onRequest }));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/caution',
        params: { id: 'caution' },
      });

      expect(response.status).toBe(200);
      expect(recorder.captured.url).toContain('id=eq.CAUTION');
    });

    it('treats mixed case and stray spacing together as the same board', async () => {
      const recorder = requestRecorder();
      server.use(supabaseSuccess('boards', storedBoard(), { onRequest: recorder.onRequest }));

      await invokeRoute(GET_BOARD, {
        url: '/api/boards/cAuT%20IoN',
        params: { id: ' cAuT IoN ' },
      });

      expect(recorder.captured.url).toContain('id=eq.CAUTION');
    });
  });

  describe('Scenario: a board name containing anything other than letters', () => {
    // Given a lookup for a board named `CAUT10N`
    // When WoS+ tries to find it
    // Then the lookup is rejected as an invalid board name, and the archive is
    //      never consulted

    it('rejects a name with a digit in it, without consulting the archive', async () => {
      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUT10N',
        params: { id: 'CAUT10N' },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid board ID format. Only letters are allowed.',
      });
      // "the archive is never consulted": no handler is registered, so any call
      // would be recorded by the harness catch-all and fail this test.
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it.each([
      ['punctuation', "CAUTION'S"],
      ['a SQL-ish injection attempt', "CAUTION' OR '1'='1"],
      ['a PostgREST filter operator', 'CAUTION,id.gt.A'],
      ['a wildcard', 'CAUT*ON'],
    ])('rejects a name containing %s, without consulting the archive', async (_label, id) => {
      const response = await invokeRoute(GET_BOARD, { url: '/api/boards/x', params: { id } });

      expect(response.status).toBe(400);
      expect(await readJson<{ error: string }>(response)).toMatchObject({
        error: 'Invalid board ID format. Only letters are allowed.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: a board name that is too short to be a big word', () => {
    // Given a lookup for a board named `CAT`
    // When WoS+ tries to find it
    // Then the lookup is rejected as an invalid board name length, and the
    //      archive is never consulted

    it('rejects a three-letter name, without consulting the archive', async () => {
      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAT',
        params: { id: 'CAT' },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid board ID length. Must be between 4 and 12 characters.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('accepts the shortest name that is a big word', async () => {
      // The boundary itself: 4 letters is valid, so the rejection above is
      // about length and not about short names in general.
      server.use(supabaseSuccess('boards', storedBoard({ id: 'COAT' })));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/COAT',
        params: { id: 'COAT' },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Scenario: a board name that is too long to be a big word', () => {
    // Given a lookup for a board named with 13 or more letters
    // When WoS+ tries to find it
    // Then the lookup is rejected as an invalid board name length, and the
    //      archive is never consulted

    it('rejects a thirteen-letter name, without consulting the archive', async () => {
      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/long',
        params: { id: 'A'.repeat(13) },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid board ID length. Must be between 4 and 12 characters.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('accepts the longest name that is a big word', async () => {
      // The boundary itself: 12 letters is valid, so the rejection above is
      // about length and not about long names in general.
      server.use(supabaseSuccess('boards', storedBoard({ id: 'A'.repeat(12) })));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/long',
        params: { id: 'A'.repeat(12) },
      });

      expect(response.status).toBe(200);
    });

    it('#168 landed: rejects a twenty-letter name, above the approved twelve', async () => {
      // APPROVED and now enforced (#168): board names run 4–12 letters,
      // matching the chat filter. The longest word in the shared list is 8;
      // 12 is the cushion. A 20-letter name is rejected — inverted from the
      // prior "known gap" assertion, which pinned it as accepted under the
      // old 4–20 rule. The archive migration risk was checked and cleared
      // before this landed: no stored board id exceeds 12 letters.
      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/long',
        params: { id: 'A'.repeat(20) },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid board ID length. Must be between 4 and 12 characters.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: no board name at all', () => {
    // Given a lookup with no board name given
    // When WoS+ tries to find it
    // Then the lookup is rejected because a board name is required

    it('rejects a missing name', async () => {
      const response = await invokeRoute(GET_BOARD, { url: '/api/boards/', params: {} });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Board ID is required' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('rejects an empty name', async () => {
      const response = await invokeRoute(GET_BOARD, { url: '/api/boards/', params: { id: '' } });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Board ID is required' });
    });

    it('rejects a name that is nothing but spacing', async () => {
      // Spacing is stripped before validation, so this reduces to an empty
      // name — but it fails the *format* rule rather than the required rule,
      // because by then there is a string with no letters in it.
      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/blank',
        params: { id: '   ' },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid board ID format. Only letters are allowed.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('the same name rules guard the repair path', () => {
    // `specs/boards.md § Naming a board` is written about lookup, but the
    // repair path runs the identical validation before it touches anything.
    // Asserted here so the two paths cannot drift apart unnoticed.

    it.each([
      ['a name with a digit', 'CAUT10N', 'Invalid board ID format. Only letters are allowed.'],
      ['a name that is too short', 'CAT', 'Invalid board ID length. Must be between 4 and 12 characters.'],
      ['a name that is too long', 'A'.repeat(13), 'Invalid board ID length. Must be between 4 and 12 characters.'],
    ])('refuses a repair addressed to %s', async (_label, id, error) => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/x',
        params: { id },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ error: string }>(response)).toMatchObject({ error });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('refuses a repair with no board name', async () => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/',
        params: {},
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Board ID is required' });
    });
  });
});

// ===========================================================================
// specs/boards.md § Looking up a board
// ===========================================================================

describe('specs/boards.md — Looking up a board', () => {
  describe('Scenario: the board has been seen before', () => {
    // Given the board `CAUTION` is in the archive with all of its slots
    // When WoS+ looks up `CAUTION`
    // Then the board comes back with every slot and its word

    it('returns the stored board with every slot and its word', async () => {
      server.use(supabaseSuccess('boards', storedBoard()));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
      });

      expect(response.status).toBe(200);
      expect(responseHeaders(response)['content-type']).toBe('application/json');
      expect(await readJson(response)).toEqual(storedBoard());
    });

    it('asks the archive for exactly one board', async () => {
      const recorder = requestRecorder();
      // A single `once` handler: a second call would be refused by the
      // catch-all and fail this test, so this proves one call was made.
      server.use(supabaseSuccess('boards', storedBoard(), {
        once: true,
        onRequest: recorder.onRequest,
      }));

      await invokeRoute(GET_BOARD, { url: '/api/boards/CAUTION', params: { id: 'CAUTION' } });

      const url = new URL(recorder.captured.url ?? '');
      expect(url.searchParams.get('id')).toBe('eq.CAUTION');
      expect(url.searchParams.get('select')).toBe('*');
    });
  });

  describe('Scenario: the board has never been captured', () => {
    // Given the archive holds no board named `CAUTION`
    // When WoS+ looks up `CAUTION`
    // Then WoS+ is told the board is not found — this is a normal answer, not a
    //      failure, and the level simply falls back to working the missed words
    //      out from the shared word list

    it('answers not-found rather than failing', async () => {
      server.use(supabaseNoRows('boards'));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
      });

      // "a normal answer, not a failure": 404 and not 500, so the caller can
      // tell "no such board" apart from "the archive broke" and fall back to
      // the shared word list only in the first case.
      expect(response.status).toBe(404);
      expect(await readJson(response)).toEqual({ error: 'Board not found' });
    });
  });

  describe('Scenario: the archive cannot be reached during a lookup', () => {
    // Given the board archive is unavailable
    // When WoS+ looks up `CAUTION`
    // Then WoS+ is told the lookup failed, and treats the board as unknown for
    //      the rest of the level

    it('reports the failure, distinguishably from not-found', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        code: '42P01',
        message: 'relation "boards" does not exist',
      }));

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.stringContaining('relation "boards" does not exist'),
      });
    });

    it('reports a failure when the archive credentials are missing, without reaching out', async () => {
      silenceRouteLogging();

      const response = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.any(String),
      });
      // Nothing was attempted, so the route did not fall back to another host.
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });
});

// ===========================================================================
// specs/boards.md § Repairing a board that was stored with repeated words
// ===========================================================================

describe('specs/boards.md — Repairing a board that was stored with repeated words', () => {
  describe('Scenario: a corrupted stored board is replaced by a clean capture', () => {
    // Given the stored board `CAUTION` has the same word in two slots
    // And WoS+ has just captured `CAUTION` cleanly, with every slot a
    //     different word
    // When WoS+ offers the clean capture as a repair
    // Then the stored board's slots are replaced by the clean ones

    it('replaces the corrupted slots with the clean ones', async () => {
      const update = requestRecorder();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], {
          method: 'patch',
          once: true,
          onRequest: update.onRequest,
        }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(200);
      expect(update.captured.body).toEqual({ slots: CLEAN_SLOTS });
      expect(new URL(update.captured.url ?? '').searchParams.get('id')).toBe('eq.CAUTION');
    });

    it('spots the repeated words even when the archive returns slots as JSON text', async () => {
      /**
       * The `slots` column comes back as a JSON *string* rather than a parsed
       * array (see `coerceSlots` in `src/lib/board-utils.ts`). If the redundancy
       * check did not parse it, every stored board would look clean and the
       * repair path would never run at all — the exact bug `coerceSlots` exists
       * to prevent. This asserts the repair still fires in that shape.
       */
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: JSON.stringify(REDUNDANT_SLOTS) }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], { method: 'patch', once: true }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(200);
    });

    it('answers with an empty list when the archive reports back no rows', async () => {
      // `.select()` after an update can come back empty even though the write
      // succeeded. The route answers `[]` rather than `null`, so the caller
      // always gets a list it can read.
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', null, { method: 'patch', once: true }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual([]);
    });
  });

  describe('Scenario: a repair also fills in a missing channel and language', () => {
    // Given the stored board `CAUTION` is being repaired
    // And the clean capture came from a known channel, in a known language
    // When the repair is applied
    // Then the channel and language are recorded on the stored board too

    it('records the channel and language alongside the repaired slots', async () => {
      const update = requestRecorder();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], {
          method: 'patch',
          once: true,
          onRequest: update.onRequest,
        }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS, twitch_channel: '#ClarkIO', language_code: 'PT' },
      });

      expect(response.status).toBe(200);
      // Both are tidied on the way in, exactly as they are on a first capture.
      expect(update.captured.body).toEqual({
        slots: CLEAN_SLOTS,
        twitch_channel: 'clarkio',
        language_code: 'pt',
      });
    });
  });

  describe('Scenario: a repair carrying no channel or language leaves those alone', () => {
    // Given the stored board `CAUTION` is being repaired
    // And the repair carries no channel, or a channel name that is not a real
    //     Twitch name
    // When the repair is applied
    // Then the slots are replaced but whatever channel and language were
    //      already recorded stay as they were

    it('writes only the slots when the repair carries neither', async () => {
      const update = requestRecorder();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], {
          method: 'patch',
          once: true,
          onRequest: update.onRequest,
        }),
      );

      await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      // "stay as they were" is expressed by *absence* from the update: a
      // payload carrying `twitch_channel: null` would erase the stored value.
      expect(update.captured.body).toEqual({ slots: CLEAN_SLOTS });
      expect(update.captured.body).not.toHaveProperty('twitch_channel');
      expect(update.captured.body).not.toHaveProperty('language_code');
    });

    it.each([
      ['a channel with spaces in it', 'not a channel'],
      ['a channel with punctuation', 'clark.io!'],
      ['a channel longer than fifty characters', 'c'.repeat(51)],
      ['a channel that is not text at all', 12345],
    ])('leaves the stored channel alone when the repair carries %s', async (_label, channel) => {
      const update = requestRecorder();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], {
          method: 'patch',
          once: true,
          onRequest: update.onRequest,
        }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS, twitch_channel: channel },
      });

      // Never rejected: the channel is informational and must not block a
      // repair.
      expect(response.status).toBe(200);
      expect(update.captured.body).toEqual({ slots: CLEAN_SLOTS });
    });

    it('leaves the stored language alone when the repair carries one WoS does not play in', async () => {
      const update = requestRecorder();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseSuccess('boards', [storedBoard()], {
          method: 'patch',
          once: true,
          onRequest: update.onRequest,
        }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS, language_code: 'de' },
      });

      expect(response.status).toBe(200);
      expect(update.captured.body).toEqual({ slots: CLEAN_SLOTS });
    });
  });

  describe('Scenario: a sound stored board is never overwritten', () => {
    // Given the stored board `CAUTION` has no repeated words
    // When a repair is offered for it
    // Then the repair is refused, the stored board is untouched, and the reason
    //      says the board has no repeated words

    it('refuses the repair and leaves the stored board untouched', async () => {
      // Only the read handler is registered. If the route issued the update
      // anyway, the catch-all would record it and the harness `afterEach` would
      // fail this test — which is what "the stored board is untouched" means
      // here.
      server.use(supabaseSuccess('boards', storedBoard({ slots: CLEAN_SLOTS }), { once: true }));

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: [slot('OTHER'), slot('WORDS')] },
      });

      expect(response.status).toBe(409);
      expect(await readJson(response)).toEqual({
        error: 'Board update not allowed',
        message: 'Board CAUTION has no redundant words; refusing to overwrite it.',
        code: 'BOARD_UPDATE_NOT_ALLOWED',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('refuses the repair when the stored slots cannot be read as a board', async () => {
      // `coerceSlots` returns null for a value that is neither an array nor
      // JSON text for one, and `hasRedundantWords` then reports "clean". The
      // safety catch holds: an unreadable stored board is not overwritten
      // either, which keeps repair strictly a mender of known-broken boards.
      server.use(supabaseSuccess('boards', storedBoard({ slots: 'not json at all' }), { once: true }));

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(409);
      expect(await readJson<{ code: string }>(response)).toMatchObject({
        code: 'BOARD_UPDATE_NOT_ALLOWED',
      });
    });
  });

  describe('Scenario: a repair that itself contains repeated words', () => {
    // Given a repair for `CAUTION` in which the same word appears in two slots
    // When the repair is offered
    // Then it is rejected, nothing is changed, and the reason names the
    //      repeated words

    it('rejects the repair and names the repeated word', async () => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: REDUNDANT_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Redundant words in board slots',
        message: 'Board CAUTION update contains redundant words: action.',
        code: 'REDUNDANT_WORDS',
      });
      // Rejected before the archive was read at all — "nothing is changed" is
      // guaranteed by never having started.
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('names every repeated word when several are repeated', async () => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: {
          slots: [slot('ACTION'), slot('ACTION'), slot('COAT'), slot('COAT'), slot('CAUTION')],
        },
      });

      expect(response.status).toBe(400);
      const body = await readJson<{ message: string }>(response);
      expect(body.message).toContain('action');
      expect(body.message).toContain('coat');
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('treats the same word in two cases as a repeat', async () => {
      // Slots are the same word regardless of how the capture cased them, so
      // the guard folds case before counting.
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: [slot('ACTION'), { letters: Array.from('action'), word: 'action' }, slot('CAUTION')] },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ code: string }>(response)).toMatchObject({
        code: 'REDUNDANT_WORDS',
      });
    });
  });

  describe('Scenario: a repair with no slots', () => {
    // Given a repair for `CAUTION` that carries an empty list of slots
    // When the repair is offered
    // Then it is rejected and nothing is changed

    it.each([
      ['an empty list', []],
      ['no slots field at all', undefined],
      ['slots that are not a list', { first: slot('ACTION') }],
      ['slots given as text', 'ACTION,CAUTION'],
      ['slots given as null', null],
    ])('rejects a repair carrying %s', async (_label, slots) => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: slots === undefined ? {} : { slots },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'slots must be a non-empty array' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: a repair with a malformed slot', () => {
    // Given a repair for `CAUTION` in which some slot has no letters or no word
    // When the repair is offered
    // Then it is rejected and nothing is changed

    it.each([
      ['a slot with no letters', [{ word: 'ACTION' }, slot('CAUTION')]],
      ['a slot whose letters are not a list', [{ letters: 'ACTION', word: 'ACTION' }, slot('CAUTION')]],
      ['a slot with no word', [{ letters: Array.from('ACTION') }, slot('CAUTION')]],
      ['a slot with an empty word', [{ letters: Array.from('ACTION'), word: '' }, slot('CAUTION')]],
      ['a slot whose word is not text', [{ letters: Array.from('ACTION'), word: 42 }, slot('CAUTION')]],
      ['a slot that is null', [null, slot('CAUTION')]],
      ['a slot that is not an object', ['ACTION', slot('CAUTION')]],
    ])('rejects a repair containing %s', async (_label, slots) => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Invalid slot structure detected' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: a repair that cannot be read at all', () => {
    // Given a repair for `CAUTION` whose contents WoS+ cannot make sense of
    // When the repair is offered
    // Then it is rejected and nothing is changed

    it.each([
      ['text that is not JSON', 'not json'],
      ['an empty body', ''],
      ['truncated JSON', '{"slots": ['],
    ])('rejects a repair sent as %s', async (_label, body) => {
      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        headers: { 'content-type': 'application/json' },
        body,
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Invalid JSON body' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: a repair for a board that was never captured', () => {
    // Given the archive holds no board named `CAUTION`
    // When a repair is offered for `CAUTION`
    // Then WoS+ is told the board is not found, and no new board is created

    it('answers not-found and creates nothing', async () => {
      // Only the read handler is registered, so an insert or update would be
      // recorded by the catch-all and fail this test. That is the "no new board
      // is created" half of the scenario: repair must never become a second way
      // to add a board.
      server.use(supabaseNoRows('boards', { once: true }));

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(404);
      expect(await readJson(response)).toEqual({ error: 'Board not found' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: the archive cannot be reached during a repair', () => {
    // Given the board archive is unavailable
    // When a repair is offered
    // Then nothing is changed and WoS+ is told the repair failed

    it('reports a failure that strikes while reading the stored board', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        code: '42P01',
        message: 'relation "boards" does not exist',
      }, { once: true }));

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.stringContaining('relation "boards" does not exist'),
      });
    });

    it('reports a failure that strikes while writing the repaired slots', async () => {
      silenceRouteLogging();
      server.use(
        supabaseSuccess('boards', storedBoard({ slots: REDUNDANT_SLOTS }), { once: true }),
        supabaseFailure('boards', { message: 'connection reset by peer' }, {
          method: 'patch',
          once: true,
          status: 500,
        }),
      );

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.stringContaining('connection reset by peer'),
      });
    });

    it('reports a failure when the archive credentials are missing, without reaching out', async () => {
      silenceRouteLogging();

      const response = await invokeRoute(PUT, {
        method: 'PUT',
        url: '/api/boards/CAUTION',
        params: { id: 'CAUTION' },
        json: { slots: CLEAN_SLOTS },
        workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });
});

// ===========================================================================
// Transport concerns for /api/boards/[id] (no spec section)
// ===========================================================================

describe('/api/boards/[id] — transport concerns (no spec section)', () => {
  /**
   * CORS is not described in `specs/boards.md` — it is a transport detail
   * rather than game behaviour. Unlike `/api/words`, this route does **not**
   * use `getCorsOrigin` from `src/lib/cors.ts`: it ships a fixed
   * `Access-Control-Allow-Origin: *`. The `cors.ts` `"undefined"` defect
   * therefore cannot surface here, and nothing below depends on it.
   */

  it('allows any origin on every answer it gives', async () => {
    server.use(supabaseSuccess('boards', storedBoard()));

    const response = await invokeRoute(GET_BOARD, {
      url: '/api/boards/CAUTION',
      params: { id: 'CAUTION' },
      headers: { origin: 'https://wosplus.com' },
    });

    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
    });
  });

  it('sends CORS headers on rejections too, so a browser can read the reason', async () => {
    // A 400 with no CORS headers is opaque to a browser caller: it sees a
    // network error rather than "that board name is invalid".
    const response = await invokeRoute(GET_BOARD, {
      url: '/api/boards/CAUT10N',
      params: { id: 'CAUT10N' },
    });

    expect(response.status).toBe(400);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('*');
  });

  it('exports the OPTIONS handler its Access-Control-Allow-Methods promises (fixed #172)', async () => {
    /**
     * Was a ⚠️ GAP canary: `Access-Control-Allow-Methods` promised
     * `GET, PUT, OPTIONS` while the module exported no `OPTIONS` handler, so a
     * real preflight (triggered in practice by a JSON `PUT` from a browser)
     * fell through to Astro's 404. Fixed by exporting `OPTIONS` alongside
     * `GET`/`PUT`, per issue #172.
     */
    const exportedHandlers = Object.keys(boardByIdRoute)
      .filter((name) => /^[A-Z]+$/.test(name))
      .sort();

    expect(exportedHandlers).toEqual(['GET', 'OPTIONS', 'PUT']);
  });

  it('answers a preflight with no body (#172)', async () => {
    const response = await invokeRoute(boardByIdRoute.OPTIONS, {
      method: 'OPTIONS',
      url: '/api/boards/CAUTION',
      params: { id: 'CAUTION' },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
    });
  });
});

// ===========================================================================
// specs/boards.md § Capturing a board
// ===========================================================================

describe('specs/boards.md — Capturing a board', () => {
  /**
   * A board is only ever captured from a level WoS+ believes is complete. The
   * *when* — which level state triggers a capture — lives in
   * `specs/game-flow.md` and in `src/scripts/wos-plus-main.ts`; this route only
   * sees the finished capture. So these tests assert what the archive is asked
   * to store, and never that a capture happened at the right moment.
   */

  describe('Scenario: a completed board is captured', () => {
    // Given a level ended with every slot filled by a player
    // And the big word is known
    // When WoS+ captures the board
    // Then the board is filed under its big word, with every slot's word, and
    //      with the Twitch channel and the game's word language recorded
    //      alongside it

    it('files the board under its big word with every slot, channel and language', async () => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: {
          id: 'CAUTION',
          slots: CLEAN_SLOTS,
          twitch_channel: 'clarkio',
          language_code: 'en',
        },
      });

      expect(response.status).toBe(200);
      expect(responseHeaders(response)['content-type']).toBe('application/json');
      expect(insert.captured.body).toEqual({
        id: 'CAUTION',
        slots: CLEAN_SLOTS,
        twitch_channel: 'clarkio',
        language_code: 'en',
      });
    });

    it('hands back the stored row so the caller knows what was filed', async () => {
      server.use(supabaseSuccess('boards', [storedBoard()], { method: 'post' }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(await readJson(response)).toEqual([storedBoard()]);
    });
  });

  describe('Scenario: the board was already captured', () => {
    // Given the board `CAUTION` is already in the archive, and its stored copy
    //       is sound
    // When WoS+ captures `CAUTION` again
    // Then nothing is saved, the stored board is left exactly as it was, and
    //      WoS+ reports that the board has already been saved

    it('reports the board as already saved when the archive rejects the duplicate', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        code: '23505',
        message: 'duplicate key value violates unique constraint "boards_pkey"',
      }, { method: 'post', status: 409, once: true }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      });

      // Not a 500: "already saved" is an expected outcome of a re-capture, and
      // the caller must be able to tell it apart from a broken archive.
      expect(response.status).toBe(409);
      expect(await readJson(response)).toEqual({
        error: 'Board already exists',
        message: 'Board CAUTION has already been saved.',
        code: 'BOARD_EXISTS',
      });
    });

    it('recognises the duplicate from the message when no error code is given', async () => {
      // The uniqueness violation is the archive's own answer, and not every
      // deployment surfaces the SQLSTATE. The route falls back to the message.
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        message: 'duplicate key value violates unique constraint "boards_pkey"',
      }, { method: 'post', status: 409, once: true }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(response.status).toBe(409);
      expect(await readJson<{ code: string }>(response)).toMatchObject({ code: 'BOARD_EXISTS' });
    });

    it('names the board even when the capture carried no id', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }, { method: 'post', status: 409, once: true }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(await readJson<{ message: string }>(response)).toMatchObject({
        message: 'Board ID has already been saved.',
      });
    });

    it('does not mistake a nameless, codeless failure for an already-saved board', async () => {
      // The duplicate check reads a code *or* a message. When the archive gives
      // neither, the capture must be reported as a failure — answering 409
      // would tell the caller its board is safely stored when it is not.
      silenceRouteLogging();
      server.use(supabaseFailure('boards', { message: '' }, {
        method: 'post',
        status: 400,
        once: true,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(response.status).toBe(500);
    });
  });

  describe('Scenario: a capture where the same word fills two slots', () => {
    // Given a capture of board `CAUTION` in which the word `ACTION` appears in
    //       two different slots
    // When WoS+ tries to save it
    // Then the board is rejected, nothing is saved, and the reason names the
    //      word or words that were repeated

    it('rejects the capture, names the repeated word, and saves nothing', async () => {
      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: REDUNDANT_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Redundant words in board slots',
        message: 'Board CAUTION contains redundant words: action.',
        code: 'REDUNDANT_WORDS',
      });
      // "nothing is saved": no insert handler is registered, so any call the
      // route made would be recorded by the catch-all and fail this test.
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('names every repeated word when several are repeated', async () => {
      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: {
          id: 'CAUTION',
          slots: [slot('ACTION'), slot('ACTION'), slot('COAT'), slot('COAT'), slot('CAUTION')],
        },
      });

      expect(response.status).toBe(400);
      const body = await readJson<{ message: string }>(response);
      expect(body.message).toContain('action');
      expect(body.message).toContain('coat');
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('still explains itself when the capture carried no board name', async () => {
      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { slots: REDUNDANT_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ message: string }>(response)).toMatchObject({
        message: 'Board ID contains redundant words: action.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('spots the repeat regardless of how the capture cased the word', async () => {
      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: {
          id: 'CAUTION',
          slots: [slot('ACTION'), { letters: Array.from('action'), word: 'action' }, slot('CAUTION')],
        },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ code: string }>(response)).toMatchObject({
        code: 'REDUNDANT_WORDS',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });

  describe('Scenario: a capture where a word was never fully worked out', () => {
    // Given a capture in which at least one slot still has masked letters or an
    //       empty word
    // When WoS+ tries to save it
    // Then nothing is saved — an incomplete board is worse than no board
    //
    // This scenario is NOT enforced by this route. The route's only slot check
    // is the repeated-word guard; a slot with an empty word is simply ignored
    // by `findRedundantWords` and the board is saved as-is. The spec records
    // that gap under "Open questions" as "a board saved with malformed slots",
    // and it is pinned there rather than asserted as contract here.
    //
    // What *does* enforce it today is the capture side in
    // `src/scripts/wos-plus-main.ts`, which only offers a board once every slot
    // is solved. That is out of this task's scope (game flow is task 6), so
    // this describe deliberately asserts nothing and points at both halves.

    it.todo(
      'incomplete captures are refused by the archive itself — ' +
      'open question: the route does not check slot completeness, only repeated words; ' +
      'see the "a board saved with malformed slots" open question below',
    );
  });
});

// ===========================================================================
// specs/boards.md § Channel and language on a captured board
// ===========================================================================

describe('specs/boards.md — Channel and language on a captured board', () => {
  /**
   * Both are informational: recorded when they make sense, quietly dropped when
   * they do not, and neither may ever stop a good board from being saved. Every
   * test below therefore asserts the save still succeeded as well as what was
   * written.
   */

  describe('Scenario: a channel name is tidied before it is recorded', () => {
    // Given a capture from the channel `#ClarkIO`
    // When the board is saved
    // Then the board records the channel as `clarkio`

    it.each([
      ['a leading hash', '#ClarkIO'],
      ['upper case', 'CLARKIO'],
      ['surrounding spaces', '  clarkio  '],
      ['all three at once', '  #ClarkIO  '],
    ])('records the channel as clarkio when the capture carries %s', async (_label, channel) => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, twitch_channel: channel, language_code: 'en' },
      });

      expect(response.status).toBe(200);
      expect(insert.captured.body).toMatchObject({ twitch_channel: 'clarkio' });
    });

    it('keeps a channel name that is already tidy', async () => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, twitch_channel: 'wos_player_1', language_code: 'en' },
      });

      expect(insert.captured.body).toMatchObject({ twitch_channel: 'wos_player_1' });
    });
  });

  describe('Scenario: a channel name that is not a real Twitch name', () => {
    // Given a capture whose channel name contains spaces, punctuation, or is
    //       longer than 50 characters
    // When the board is saved
    // Then the board is saved without any channel recorded, rather than being
    //      rejected

    it.each([
      ['spaces', 'not a channel'],
      ['punctuation', 'clark.io!'],
      ['more than fifty characters', 'c'.repeat(51)],
      ['nothing at all', ''],
      ['a value that is not text', 12345],
      ['a null', null],
    ])('saves the board with no channel when the capture carries %s', async (_label, channel) => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, twitch_channel: channel, language_code: 'en' },
      });

      // "rather than being rejected" is the load-bearing half: a bad channel
      // name must cost the archive a channel, never a board.
      expect(response.status).toBe(200);
      expect(insert.captured.body).not.toHaveProperty('twitch_channel');
      expect(insert.captured.body).toMatchObject({ id: 'CAUTION', slots: CLEAN_SLOTS });
    });

    it('accepts a channel name of exactly fifty characters', async () => {
      // The boundary itself, so the rejection above is about length and not
      // about long names in general.
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, twitch_channel: 'c'.repeat(50), language_code: 'en' },
      });

      expect(insert.captured.body).toMatchObject({ twitch_channel: 'c'.repeat(50) });
    });
  });

  describe('Scenario: the games word language is recorded', () => {
    // Given a capture from a game playing in Portuguese
    // When the board is saved
    // Then the board records Portuguese as its word language

    it.each([
      ['Portuguese', 'pt'],
      ['English', 'en'],
      ['French', 'fr'],
    ])('records %s on the saved board', async (_label, code) => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: code },
      });

      expect(response.status).toBe(200);
      expect(insert.captured.body).toMatchObject({ language_code: code });
    });

    it('tidies the language code before recording it', async () => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: '  PT  ' },
      });

      expect(insert.captured.body).toMatchObject({ language_code: 'pt' });
    });
  });

  describe('Scenario: an unrecognised word language', () => {
    // Given a capture whose word language is not one Words on Stream plays in
    // When the board is saved
    // Then the board is rejected and nothing is saved
    //
    // known gap (#161), inverted in place: WoS+ used to save the board with
    // English substituted for the unrecognised language, which quietly
    // corrupted the archive. It now rejects the capture instead.

    it.each([
      ['a language WoS does not play in', 'de'],
      ['a locale rather than a language', 'en-GB'],
      ['nothing at all', ''],
      ['a value that is not text', 2],
      ['a null', null],
    ])('rejects the save and stores nothing when the capture carries %s', async (_label, code) => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: code },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ code: 'INVALID_LANGUAGE' });
      // The route returned before ever asking Supabase to insert anything.
      expect(insert.captured.body).toBeUndefined();
    });
  });

  describe('Scenario: a capture with no word language at all', () => {
    // Given a capture that carries no word language
    // When the board is saved
    // Then the board is rejected and nothing is saved

    it('rejects the save and stores nothing when the capture carries no language key', async () => {
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ code: 'INVALID_LANGUAGE' });
      expect(insert.captured.body).toBeUndefined();
    });
  });

  describe('the channel stays informational even though the language is now required', () => {
    it('saves the board with no channel recorded when the capture carries a supported language but no channel', async () => {
      // The channel remains "recorded when it makes sense, quietly dropped
      // when it does not" — #161 only tightened the language rule.
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(response.status).toBe(200);
      expect(insert.captured.body).toEqual({ id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' });
    });
  });
});

// ===========================================================================
// specs/boards.md § Browsing the archive
// ===========================================================================

describe('specs/boards.md — Browsing the archive', () => {
  describe('Scenario: listing every captured board', () => {
    // Given the archive holds several boards
    // When the whole archive is requested
    // Then every stored board comes back, each with its slots

    it('returns every stored board with its slots', async () => {
      const archive = [
        storedBoard(),
        storedBoard({ id: 'TRILBY', slots: [slot('TRILBY')] }),
        storedBoard({ id: 'COAT', slots: [slot('COAT')] }),
      ];
      server.use(supabaseSuccess('boards', archive));

      const response = await invokeRoute(GET_BOARDS, { url: '/api/boards' });

      expect(response.status).toBe(200);
      expect(responseHeaders(response)['content-type']).toBe('application/json');
      expect(await readJson(response)).toEqual(archive);
    });

    it('asks the archive for whole boards, once', async () => {
      const recorder = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        once: true,
        onRequest: recorder.onRequest,
      }));

      await invokeRoute(GET_BOARDS, { url: '/api/boards' });

      const url = new URL(recorder.captured.url ?? '');
      expect(url.searchParams.get('select')).toBe('*');
      // No filter: the whole archive, not a slice of it.
      expect(url.searchParams.get('id')).toBeNull();
    });
  });

  describe('Scenario: an empty archive', () => {
    // Given the archive holds no boards at all
    // When the whole archive is requested
    // Then an empty list comes back — this is a normal answer, not a failure

    it('answers with an empty list, as an ordinary answer', async () => {
      server.use(supabaseSuccess('boards', []));

      const response = await invokeRoute(GET_BOARDS, { url: '/api/boards' });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual([]);
    });
  });

  describe('Scenario: the archive cannot be reached while listing', () => {
    // Given the board archive is unavailable
    // When the whole archive is requested
    // Then WoS+ is told the listing failed, and no boards come back

    it('reports the failure instead of passing an empty archive off as the answer', async () => {
      silenceRouteLogging();
      server.use(supabaseFailure('boards', {
        code: '42P01',
        message: 'relation "boards" does not exist',
      }));

      const response = await invokeRoute(GET_BOARDS, { url: '/api/boards' });

      expect(response.status).toBe(500);
      const body = await readJson<{ error?: string }>(response);
      expect(body.error).toContain('relation "boards" does not exist');
      // A failure must never be mistakable for "the archive is empty".
      expect(body).not.toEqual([]);
    });

    it('reports a failure when the archive credentials are missing, without reaching out', async () => {
      silenceRouteLogging();

      const response = await invokeRoute(GET_BOARDS, {
        url: '/api/boards',
        workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });
});

// ===========================================================================
// specs/boards.md § Capturing a board — a capture that cannot be stored
// ===========================================================================

describe('specs/boards.md — a capture that cannot be stored', () => {
  /**
   * Not its own spec scenario, but the counterpart to "the archive cannot be
   * reached" on every other path: a capture that fails for a reason other than
   * the board already existing must be reported as a failure, and must not be
   * confused with the 409 that means "already saved".
   */

  it('reports a storage failure as a failure, not as an already-saved board', async () => {
    silenceRouteLogging();
    server.use(supabaseFailure('boards', {
      code: '42501',
      message: 'permission denied for table boards',
    }, { method: 'post', status: 403, once: true }));

    const response = await invokeRoute(POST, {
      method: 'POST',
      url: '/api/boards',
      json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
    });

    expect(response.status).toBe(500);
    expect(await readJson<{ error?: string }>(response)).toMatchObject({
      error: expect.stringContaining('permission denied for table boards'),
    });
  });

  it('reports a failure when the archive credentials are missing, without reaching out', async () => {
    silenceRouteLogging();

    const response = await invokeRoute(POST, {
      method: 'POST',
      url: '/api/boards',
      json: { id: 'CAUTION', slots: CLEAN_SLOTS, language_code: 'en' },
      workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
    });

    expect(response.status).toBe(500);
    expect(unhandledNetworkRequests()).toEqual([]);
  });

  it('does not crash on a capture whose body is JSON null (issue #161: rejected for missing language, not the archive)', async () => {
    // `null` parses cleanly, so it gets past the body guard and reaches the
    // channel/language handling, which is written with `?.` and `?? {}`
    // precisely so a null body cannot throw there. Since #161, a missing
    // language now short-circuits before the archive is ever consulted — the
    // capture is rejected for that reason rather than reaching Supabase's
    // not-null constraint on `id`.
    const response = await invokeRoute(POST, {
      method: 'POST',
      url: '/api/boards',
      json: null,
    });

    expect(response.status).toBe(400);
    expect(await readJson<{ code?: string }>(response)).toMatchObject({ code: 'INVALID_LANGUAGE' });
    expect(unhandledNetworkRequests()).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['an empty body', ''],
    ['truncated JSON', '{"slots": ['],
  ])('rejects a capture sent as %s', async (_label, body) => {
    /**
     * BUG FOUND AND FIXED by this test.
     *
     * `POST /api/boards` called `await request.json()` outside its `try`, so an
     * unreadable body threw out of the handler instead of being answered. Astro
     * turns that into a 500 error page with **no CORS headers**, so a browser
     * caller sees an opaque network error rather than a reason — and the
     * sibling `PUT /api/boards/[id]` already answered the identical case with a
     * 400 `Invalid JSON body`. The two paths disagreed about the same input.
     *
     * The fix makes `POST` match `PUT` exactly. This test asserts the correct
     * behaviour, not the behaviour that shipped.
     */
    const response = await invokeRoute(POST, {
      method: 'POST',
      url: '/api/boards',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'Invalid JSON body' });
    // The CORS headers are the point of answering rather than throwing: without
    // them a browser cannot read the reason it was rejected.
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('*');
    expect(unhandledNetworkRequests()).toEqual([]);
  });
});

// ===========================================================================
// Transport concerns for /api/boards (no spec section)
// ===========================================================================

describe('/api/boards — transport concerns (no spec section)', () => {
  it('allows any origin on every answer it gives', async () => {
    server.use(supabaseSuccess('boards', [storedBoard()]));

    const response = await invokeRoute(GET_BOARDS, {
      url: '/api/boards',
      headers: { origin: 'https://wosplus.com' },
    });

    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
  });

  it('sends CORS headers on rejections too, so a browser can read the reason', async () => {
    const response = await invokeRoute(POST, {
      method: 'POST',
      url: '/api/boards',
      json: { id: 'CAUTION', slots: REDUNDANT_SLOTS },
    });

    expect(response.status).toBe(400);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('*');
  });

  it('exports the OPTIONS handler its Access-Control-Allow-Methods promises (fixed #172)', async () => {
    /**
     * Was a GAP canary, same class as `/api/boards/[id]`: `Access-Control-
     * Allow-Methods` promised `GET, POST, OPTIONS` while no `OPTIONS` handler
     * existed, so a real preflight (triggered in practice by a JSON `POST`
     * from a browser) fell through to Astro's 404. Fixed by exporting
     * `OPTIONS` alongside `GET`/`POST`, per issue #172.
     */
    const exportedHandlers = Object.keys(boardsRoute)
      .filter((name) => /^[A-Z]+$/.test(name))
      .sort();

    expect(exportedHandlers).toEqual(['GET', 'OPTIONS', 'POST']);
  });

  it('answers a preflight with no body (#172)', async () => {
    const response = await invokeRoute(boardsRoute.OPTIONS, {
      method: 'OPTIONS',
      url: '/api/boards',
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
  });
});

// ===========================================================================
// specs/boards.md § Saving a board directly, § Known limitations
//
// ANSWERED by the maintainer in review of PR #160. These were open questions;
// they are now decisions, and the spec has been rewritten to state the approved
// behaviour rather than the current behaviour.
// ===========================================================================

describe('specs/boards.md — approved changes not yet implemented (current behaviour under protest)', () => {
  /**
   * Every test in this block asserts what WoS+ does **today**, which the
   * maintainer has now ruled is **wrong**. They are kept, not deleted, and this
   * is deliberate — per `CLAUDE.md` §2.2 an existing assertion is never removed
   * to make a change pass.
   *
   * Their job has changed. They no longer ask a question; they hold the current
   * behaviour still so that implementing the approved change cannot happen
   * silently. Landing #162 or #165 *must* turn these red, and the fix is to
   * invert each assertion in that same PR — not to delete it here first.
   *
   * If you are reading this because one of them just failed: that is the
   * mechanism working. Check the issue named on the test, and invert it.
   */

  describe('Scenario: a board offered for saving under a name that is not a big word', () => {
    // APPROVED (#162): the board is rejected as an invalid board name, and
    //                  nothing is saved.
    // TODAY:           the name is not checked, and the board is saved.
    //
    // The assertions below pin TODAY. Invert them when #162 lands.

    it.each([
      ['a name that is too short', 'CAT'],
      ['a name with a digit in it', 'CAUT10N'],
      ['a name that is too long', 'A'.repeat(21)],
      ['a name that is not letters at all', '!!!'],
    ])('known gap (#162): stores a board named with %s', async (_label, id) => {
      /**
       * KNOWN GAP (#162) — pins current behaviour; the maintainer has ruled it wrong.
       *
       * Approved: the save path applies the same name rules as the
       * lookup and repair paths? `validateBoardId` lives in `[id].ts` and is
       * never called by `index.ts`, so a board can be filed under a name that
       * the lookup rules will then always reject — see the companion test
       * below, which shows the board becoming unreachable.
       *
       * Asserted only to make the asymmetry visible and to fail loudly if it
       * changes. NOT a statement that saving such a board is right.
       */
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard({ id })], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id, slots: CLEAN_SLOTS, language_code: 'en' },
      });

      expect(response.status).toBe(200);
      expect(insert.captured.body).toMatchObject({ id });
    });

    it('known gap (#162): a board saved under a bad name can then never be looked up', async () => {
      /**
       * KNOWN GAP (#162) — the consequence of the asymmetry above, spelled out.
       *
       * The save succeeds; the lookup of the very same name is rejected before
       * the archive is consulted. The board is in the archive and unreachable
       * through the normal path. The maintainer has ruled the save path must
       * apply the same name rules, so this test inverts when #162 lands.
       */
      server.use(supabaseSuccess('boards', [storedBoard({ id: 'CAUT10N' })], {
        method: 'post',
        once: true,
      }));

      const saved = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUT10N', slots: CLEAN_SLOTS, language_code: 'en' },
      });
      expect(saved.status).toBe(200);

      const lookup = await invokeRoute(GET_BOARD, {
        url: '/api/boards/CAUT10N',
        params: { id: 'CAUT10N' },
      });

      expect(lookup.status).toBe(400);
      expect(await readJson<{ error: string }>(lookup)).toMatchObject({
        error: 'Invalid board ID format. Only letters are allowed.',
      });
    });
  });

  describe('Scenario: a board offered for saving with malformed slots', () => {
    // Given a board is offered for saving whose slots have no letters, or no
    //       words
    // When the save is attempted
    // Then only the repeated-word rule is applied; the slots' shape is not
    //      checked, and the board is saved

    it.each([
      ['a slot with no letters', [{ word: 'ACTION' }, slot('CAUTION')]],
      ['a slot with no word', [{ letters: Array.from('ACTION') }, slot('CAUTION')]],
      ['a slot with an empty word', [{ letters: Array.from('ACTION'), word: '' }, slot('CAUTION')]],
      ['a slot that is null', [null, slot('CAUTION')]],
      ['no slots at all', []],
    ])('known gap (#162): stores a board containing %s', async (_label, slots) => {
      /**
       * KNOWN GAP (#162) — pins current behaviour; the maintainer has ruled it wrong.
       *
       * Approved: the save path applies the same slot-shape rules as
       * the repair path? `PUT /api/boards/[id]` rejects every one of these with
       * `Invalid slot structure detected` (see the "a repair with a malformed
       * slot" describe above), while `POST` stores them. The two paths disagree
       * about what a valid slot is.
       *
       * This is also what leaves `specs/boards.md § a capture where a word was
       * never fully worked out` unenforced at the archive: a slot with an empty
       * word is exactly an unsolved slot.
       */
      const insert = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        method: 'post',
        once: true,
        onRequest: insert.onRequest,
      }));

      const response = await invokeRoute(POST, {
        method: 'POST',
        url: '/api/boards',
        json: { id: 'CAUTION', slots, language_code: 'en' },
      });

      expect(response.status).toBe(200);
      expect(insert.captured.body).toMatchObject({ slots });
    });
  });

  describe('Scenario: the big word disagrees with the last slot', () => {
    // Given a level is being captured
    // And the big word WoS+ tracked during the level is not the word in the
    //     board's last slot
    // When the board is captured
    // Then the board is filed under the *last slot's* word instead of the
    //      tracked big word

    it.todo(
      'known gap (#165): a capture is filed under the last slot word rather than the longest, ' +
      'alphabetically-last word the maintainer approved as the board identity. ' +
      'Not reachable from /api/boards: the substitution happens in the capture path in ' +
      'src/scripts/wos-plus-main.ts before the route is called, and the route stores the id it is ' +
      'given. Belongs with the game-flow work (specs/game-flow.md)',
    );
  });

  describe('Scenario: a very large archive', () => {
    // Given the archive holds many thousands of boards
    // When the whole archive is requested
    // Then every board is returned at once, with no way to ask for a page at a
    //      time

    it('confirmed intended (#160 review): asks for the whole archive in one go, with no paging', async () => {
      /**
       * CONFIRMED INTENDED (#160 review) — the maintainer confirmed no paging is
       * fine for now: playing the game has turned up ~1,600 boards in total and
       * that is not expected to grow quickly. Revisit alongside the stored slot
       * shape if Words on Stream ever ships thousands.
       *
       * Background: should listing the archive be paged? Nothing in WoS+
       * asks for the whole archive today, so this may be an unused capability
       * that has simply not needed paging yet. `/api/words` — which *is* used
       * at start-up — does page, in 1000-row batches, so both the machinery and
       * the precedent already exist.
       *
       * Pinned by asserting the request carries none of the paging parameters
       * `.range()` would add, and that the route makes exactly one call (a
       * single `once` handler). If paging is added, this fails and the question
       * must be answered.
       */
      const recorder = requestRecorder();
      const archive = Array.from({ length: 2500 }, (_, index) => storedBoard({ id: `BOARD${index}` }));
      server.use(supabaseSuccess('boards', archive, { once: true, onRequest: recorder.onRequest }));

      const response = await invokeRoute(GET_BOARDS, { url: '/api/boards' });

      expect(response.status).toBe(200);
      expect(await readJson<unknown[]>(response)).toHaveLength(2500);

      const params = new URL(recorder.captured.url ?? '').searchParams;
      expect(params.get('offset')).toBeNull();
      expect(params.get('limit')).toBeNull();
    });

    it('confirmed intended (#160 review): offers no way for a caller to ask for a page', async () => {
      /**
       * CONFIRMED INTENDED — the other half: the route ignores paging hints a
       * caller might send, so there is no undocumented paging to discover.
       * The maintainer confirmed no-paging is fine at today's ~1,600 boards.
       */
      const recorder = requestRecorder();
      server.use(supabaseSuccess('boards', [storedBoard()], {
        once: true,
        onRequest: recorder.onRequest,
      }));

      await invokeRoute(GET_BOARDS, { url: '/api/boards?offset=100&limit=10&page=3' });

      const params = new URL(recorder.captured.url ?? '').searchParams;
      expect(params.get('offset')).toBeNull();
      expect(params.get('limit')).toBeNull();
      expect(params.get('page')).toBeNull();
    });
  });
});
