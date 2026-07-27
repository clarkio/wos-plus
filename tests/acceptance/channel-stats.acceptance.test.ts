// @vitest-environment node
/**
 * ============================================================================
 * Acceptance tests for the channel record badges — `/api/channel-stats/[channel]`
 * ============================================================================
 *
 * Spec: [specs/channel-stats.md](../../specs/channel-stats.md)
 *
 * Every `describe` below names the spec section it implements, so the mapping
 * from approved scenario to executable assertion is mechanical.
 *
 * ---------------------------------------------------------------------------
 * What this route is, and what it is not
 * ---------------------------------------------------------------------------
 *
 * The route answers one question — "what are this channel's three numbers?" —
 * by making **three lookups in parallel**:
 *
 *   1. `wos_channel_all_time_records` → the all-time best     (`.single()`)
 *   2. `wos_channel_daily_achievements` → today's best and clears (`.single()`)
 *   3. `users` → is the chatbot enabled for this channel?      (`.limit(1)`)
 *
 * Each test therefore registers three `once` handlers, one per table. Because
 * an unmatched request is answered locally by the catch-all in
 * `network-mock.ts` and asserted away by its `afterEach`, registering exactly
 * three doubles as an assertion that the route made exactly three calls — no
 * more, no fewer.
 *
 * `specs/channel-stats.md § Showing the records on screen` is **not** covered
 * here. Those scenarios (badges hidden, a refresh may only raise a number, the
 * one-row scaling) are view behaviour in `src/scripts/wos-plus-main.ts`, not
 * route behaviour, and belong with the game-flow work rather than with this
 * file. The route's own half of them — what it reports, and when — is below.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpHandler } from 'msw';

import * as channelStatsRoute from '../../src/pages/api/channel-stats/[channel]';
import { GET } from '../../src/pages/api/channel-stats/[channel]';
import { normalizeTwitchChannel } from '../../src/lib/board-utils';
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

/** The three PostgREST tables the route reads, as it names them to `.from()`. */
const ALL_TIME = 'wos_channel_all_time_records';
const DAILY = 'wos_channel_daily_achievements';
const USERS = 'users';

/** The answer the route gives a channel it knows nothing at all about. */
const NO_RECORDS = {
  allTimePersonalBest: 0,
  dailyBest: 0,
  dailyClears: 0,
  chatbotEnabled: false,
};

/**
 * Registers the three lookups the route makes, each answerable exactly once.
 * The defaults describe a channel WoS+ has never seen; pass a handler to
 * override just the one lookup a scenario is about.
 */
function archiveHas(options: {
  allTime?: HttpHandler;
  daily?: HttpHandler;
  users?: HttpHandler;
} = {}): void {
  server.use(
    options.allTime ?? supabaseNoRows(ALL_TIME, { once: true }),
    options.daily ?? supabaseNoRows(DAILY, { once: true }),
    options.users ?? supabaseSuccess(USERS, [], { once: true }),
  );
}

/** An all-time record row, as `.single()` returns it. */
function allTimeRow(level: number, options = {}): HttpHandler {
  return supabaseSuccess(ALL_TIME, { all_time_highest_level_reached: level }, { once: true, ...options });
}

/** A daily achievements row for today, as `.single()` returns it. */
function dailyRow(best: number, clears: number, options = {}): HttpHandler {
  return supabaseSuccess(DAILY, { highest_level_reached: best, board_clears: clears }, { once: true, ...options });
}

/** The `users` row that marks a channel as having the chatbot enabled. */
function chatbotEnabledFor(channel: string, options = {}): HttpHandler {
  return supabaseSuccess(USERS, [{ twitch_username: channel }], { once: true, ...options });
}

/**
 * Captures the URL of the outgoing request the real `postgrest-js` client
 * built, so a test can assert on the filter that was actually sent rather than
 * merely that a 200 came back.
 */
function urlRecorder(): { captured: { url?: string }; onRequest: (request: Request) => void } {
  const captured: { url?: string } = {};
  return {
    captured,
    onRequest(request: Request) {
      captured.url = request.url;
    },
  };
}

/** The `?column=eq.value` filter `postgrest-js` put on a recorded request. */
function filterOn(captured: { url?: string }, column: string): string | null {
  return new URL(captured.url ?? '').searchParams.get(column);
}

/**
 * Silences the route's `console.error` for failure scenarios. The route is
 * *supposed* to log there, so the log is expected output, not a signal — but
 * left unmuted it buries the actual test results.
 */
function silenceRouteLogging(): void {
  vi.spyOn(console, 'error').mockImplementation(() => { /* expected */ });
}

/**
 * Pins the clock so "today in UTC" is a known date. Only `Date` is faked:
 * faking timers wholesale would stall MSW's own async plumbing.
 */
function pinClockTo(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// specs/channel-stats.md § Naming a channel
// ===========================================================================

describe('specs/channel-stats.md — Naming a channel', () => {
  /**
   * Twitch channel names are letters, digits and underscores, at most 50
   * characters, and case-insensitive. The acceptance criterion for the two
   * "same channel" scenarios is the *filter the route sent to the archive*, not
   * just a 200 — a route that ignored the name entirely would pass otherwise.
   */

  describe('Scenario: the channel name is typed with capitals', () => {
    // Given the channel `clarkio` has records
    // When stats are requested for `ClarkIO`
    // Then the same channel's records come back

    it('reads the same channel when the name arrives in mixed case', async () => {
      const allTime = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42, { onRequest: allTime.onRequest }),
        daily: dailyRow(30, 3),
        users: chatbotEnabledFor('clarkio'),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/ClarkIO',
        params: { channel: 'ClarkIO' },
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ allTimePersonalBest: 42 });
      expect(filterOn(allTime.captured, 'channel')).toBe('eq.clarkio');
    });

    it('lower-cases the name for every one of the three lookups', async () => {
      // All three tables are keyed on the same channel name. If only one of
      // them were normalised the badges would disagree with each other.
      const allTime = urlRecorder();
      const daily = urlRecorder();
      const users = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42, { onRequest: allTime.onRequest }),
        daily: dailyRow(30, 3, { onRequest: daily.onRequest }),
        users: chatbotEnabledFor('clarkio', { onRequest: users.onRequest }),
      });

      await invokeRoute(GET, {
        url: '/api/channel-stats/CLARKIO',
        params: { channel: 'CLARKIO' },
      });

      expect(filterOn(allTime.captured, 'channel')).toBe('eq.clarkio');
      expect(filterOn(daily.captured, 'channel')).toBe('eq.clarkio');
      expect(filterOn(users.captured, 'twitch_username')).toBe('eq.clarkio');
    });
  });

  describe('Scenario: the channel name has stray spacing', () => {
    // Given the channel `clarkio` has records
    // When stats are requested for `  clarkio  `
    // Then the same channel's records come back

    it('reads the same channel when the name arrives padded with spaces', async () => {
      const allTime = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42, { onRequest: allTime.onRequest }),
        daily: dailyRow(30, 3),
        users: chatbotEnabledFor('clarkio'),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: '  clarkio  ' },
      });

      expect(response.status).toBe(200);
      expect(filterOn(allTime.captured, 'channel')).toBe('eq.clarkio');
    });

    it('treats mixed case and stray spacing together as the same channel', async () => {
      const allTime = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42, { onRequest: allTime.onRequest }),
        daily: dailyRow(30, 3),
        users: chatbotEnabledFor('clarkio'),
      });

      await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: '  ClarkIO  ' },
      });

      expect(filterOn(allTime.captured, 'channel')).toBe('eq.clarkio');
    });
  });

  describe('Scenario: a channel name containing characters Twitch does not allow', () => {
    // Given stats are requested for `clark.io`
    // When WoS+ handles the request
    // Then it is rejected as an invalid channel name and no records are looked up

    it('rejects a name with a dot in it, without reading any records', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clark.io',
        params: { channel: 'clark.io' },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid channel name format. Only lowercase letters, numbers, and underscores are allowed.',
      });
      // "no records are looked up": no handler is registered, so any call would
      // be recorded by the harness catch-all and fail this test.
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it.each([
      ['a hyphen', 'clark-io'],
      ['an inner space', 'clark io'],
      ['punctuation', 'clarkio!'],
      ['a slash', 'clark/io'],
      ['an apostrophe', "clark'io"],
      ['a PostgREST filter operator', 'clarkio,twitch_username.gt.a'],
      ['a wildcard', 'clark*io'],
      ['a name that is nothing but spacing', '   '],
    ])('rejects a name containing %s, without reading any records', async (_label, channel) => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/x',
        params: { channel },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ error: string }>(response)).toMatchObject({
        error: 'Invalid channel name format. Only lowercase letters, numbers, and underscores are allowed.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('accepts the digits and underscores Twitch does allow', async () => {
      // The boundary of the rule: the rejections above are about the characters
      // themselves, not about anything other than plain letters.
      const allTime = urlRecorder();
      archiveHas({ allTime: allTimeRow(7, { onRequest: allTime.onRequest }) });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/wos_player_1',
        params: { channel: 'wos_player_1' },
      });

      expect(response.status).toBe(200);
      expect(filterOn(allTime.captured, 'channel')).toBe('eq.wos_player_1');
    });
  });

  describe('Scenario: a channel name that is too long', () => {
    // Given stats are requested for a channel name longer than 50 characters
    // When WoS+ handles the request
    // Then it is rejected as an invalid channel name length and no records are
    //      looked up

    it('rejects a fifty-one-character name, without reading any records', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/long',
        params: { channel: 'c'.repeat(51) },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        error: 'Invalid channel name length. Must be between 1 and 50 characters.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('accepts a name of exactly fifty characters', async () => {
      // The boundary itself, so the rejection above is about length and not
      // about long names in general.
      archiveHas();

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/long',
        params: { channel: 'c'.repeat(50) },
      });

      expect(response.status).toBe(200);
    });

    it('accepts a single-character name', async () => {
      // The other end of the same rule.
      archiveHas();

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/c',
        params: { channel: 'c' },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Scenario: no channel name at all', () => {
    // Given stats are requested with no channel name
    // When WoS+ handles the request
    // Then it is rejected because a channel name is required

    it('rejects a missing name', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/',
        params: {},
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Channel name is required' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('rejects an empty name', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/',
        params: { channel: '' },
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Channel name is required' });
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });
});

// ===========================================================================
// specs/channel-stats.md § Reading a channel's records
// ===========================================================================

describe("specs/channel-stats.md — Reading a channel's records", () => {
  describe('Scenario: a channel with the chatbot and a full set of records', () => {
    // Given the channel `clarkio` has the chatbot enabled
    // And it has reached level 42 at some point, level 30 today, and cleared 3
    //     boards today
    // When its stats are read
    // Then the all-time best is 42, the daily best is 30, the daily clears are
    //      3, and the channel is reported as having the chatbot

    it('reports all three numbers and that the chatbot is enabled', async () => {
      archiveHas({
        allTime: allTimeRow(42),
        daily: dailyRow(30, 3),
        users: chatbotEnabledFor('clarkio'),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(response.status).toBe(200);
      expect(responseHeaders(response)['content-type']).toBe('application/json');
      expect(await readJson(response)).toEqual({
        allTimePersonalBest: 42,
        dailyBest: 30,
        dailyClears: 3,
        chatbotEnabled: true,
      });
    });

    it('asks each table for exactly the columns the badges need', async () => {
      const allTime = urlRecorder();
      const daily = urlRecorder();
      const users = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42, { onRequest: allTime.onRequest }),
        daily: dailyRow(30, 3, { onRequest: daily.onRequest }),
        users: chatbotEnabledFor('clarkio', { onRequest: users.onRequest }),
      });

      await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(new URL(allTime.captured.url ?? '').searchParams.get('select'))
        .toBe('all_time_highest_level_reached');
      expect(new URL(daily.captured.url ?? '').searchParams.get('select'))
        .toBe('highest_level_reached,board_clears');
      expect(new URL(users.captured.url ?? '').searchParams.get('select'))
        .toBe('twitch_username');
    });
  });

  describe('Scenario: a channel without the chatbot', () => {
    // Given the channel `somestreamer` does not have the chatbot enabled
    // When its stats are read
    // Then the channel is reported as not having the chatbot, and the daily
    //      best and daily clears come back as zero

    it('reports no chatbot and zeroed daily numbers', async () => {
      archiveHas({
        allTime: allTimeRow(17),
        // No chatbot means nothing ever wrote a daily row for this channel.
        daily: supabaseNoRows(DAILY, { once: true }),
        users: supabaseSuccess(USERS, [], { once: true }),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/somestreamer',
        params: { channel: 'somestreamer' },
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        allTimePersonalBest: 17,
        dailyBest: 0,
        dailyClears: 0,
        chatbotEnabled: false,
      });
    });
  });

  describe('Scenario: a channel WoS+ has never seen', () => {
    // Given the channel `brandnew` has no records of any kind
    // When its stats are read
    // Then all three numbers come back as zero and the channel is reported as
    //      not having the chatbot — this is a normal answer, not a failure

    it('answers with zeros rather than failing', async () => {
      archiveHas();

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/brandnew',
        params: { channel: 'brandnew' },
      });

      // "a normal answer, not a failure": 200 and not 404 or 500, so a brand
      // new channel gets badges reading zero instead of an error on stream.
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(NO_RECORDS);
    });
  });

  describe('Scenario: a channel with an all-time best but nothing yet today', () => {
    // Given the channel `clarkio` has an all-time best of 42
    // And it has not played yet today
    // When its stats are read
    // Then the all-time best is 42 and both daily numbers are zero

    it('reports the all-time best with zeroed daily numbers', async () => {
      archiveHas({
        allTime: allTimeRow(42),
        daily: supabaseNoRows(DAILY, { once: true }),
        users: chatbotEnabledFor('clarkio'),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(await readJson(response)).toEqual({
        allTimePersonalBest: 42,
        dailyBest: 0,
        dailyClears: 0,
        // The chatbot is enabled even though it has nothing to say yet today,
        // so the badges stay on screen showing zero rather than disappearing.
        chatbotEnabled: true,
      });
    });
  });

  describe("Scenario: yesterday's daily numbers do not carry over", () => {
    // Given the channel `clarkio` reached level 30 and cleared 2 boards yesterday
    // And it has not played yet today
    // When its stats are read
    // Then the daily best and daily clears are zero

    it("asks only for today's row, in UTC", async () => {
      // The assertion is on the filter the route sent. A route that fetched the
      // latest row regardless of date would return yesterday's 30 and 2 and
      // still look correct from the response alone.
      pinClockTo('2026-03-15T12:00:00Z');
      const daily = urlRecorder();
      archiveHas({
        allTime: allTimeRow(42),
        daily: supabaseNoRows(DAILY, { once: true, onRequest: daily.onRequest }),
        users: chatbotEnabledFor('clarkio'),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(filterOn(daily.captured, 'stat_date_utc')).toBe('eq.2026-03-15');
      expect(await readJson(response)).toMatchObject({ dailyBest: 0, dailyClears: 0 });
    });

    it.each([
      ['the last minute of the day', '2026-03-15T23:59:59Z', 'eq.2026-03-15'],
      ['the first second of the next day', '2026-03-16T00:00:01Z', 'eq.2026-03-16'],
    ])('rolls the day over at midnight UTC — %s', async (_label, instant, expected) => {
      // "Today" is UTC for every channel, so the daily numbers reset at the same
      // moment worldwide rather than at the streamer's local midnight.
      pinClockTo(instant);
      const daily = urlRecorder();
      archiveHas({
        daily: supabaseNoRows(DAILY, { once: true, onRequest: daily.onRequest }),
      });

      await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(filterOn(daily.captured, 'stat_date_utc')).toBe(expected);
    });
  });

  describe('Scenario: whether the channel has the chatbot cannot be determined', () => {
    // Given the records for `clarkio` can be read
    // And WoS+ cannot tell whether the channel has the chatbot
    // When its stats are read
    // Then the channel is treated as **not** having the chatbot

    it('fails closed when the chatbot lookup errors', async () => {
      archiveHas({
        allTime: allTimeRow(42),
        daily: dailyRow(30, 3),
        users: supabaseFailure(USERS, {
          code: '42P01',
          message: 'relation "users" does not exist',
        }, { once: true }),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      // The numbers that *could* be read still come back — one failed lookup
      // must not cost the channel its all-time badge.
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        allTimePersonalBest: 42,
        dailyBest: 30,
        dailyClears: 3,
        // Failing on the safe side: an empty daily badge on screen looks
        // broken, so when in doubt the badges are hidden rather than blank.
        chatbotEnabled: false,
      });
    });

    it('fails closed when the chatbot lookup answers with something that is not a list', async () => {
      archiveHas({
        allTime: allTimeRow(42),
        daily: dailyRow(30, 3),
        users: supabaseSuccess(USERS, { twitch_username: 'clarkio' }, { once: true }),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(await readJson(response)).toMatchObject({ chatbotEnabled: false });
    });
  });

  describe('Scenario: the records cannot be reached at all', () => {
    // Given the channel records are unavailable
    // When stats are read
    // Then WoS+ is told the read failed, and no numbers come back

    it('reports the failure when the archive credentials are missing, without reaching out', async () => {
      silenceRouteLogging();

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
        workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(await readJson<{ error?: string }>(response)).toMatchObject({
        error: expect.any(String),
      });
      // Nothing was attempted, so the route did not fall back to another host.
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('answers 200 with zeroed numbers when every lookup errors', async () => {
      /**
       * ⚠️ GAP, recorded not fixed — a behaviour change, so out of scope here.
       *
       * The spec above says an unreachable archive must be reported as a failed
       * read with "no numbers back". That holds only when the *client* cannot be
       * built (the test above). When the database itself answers with an error,
       * `postgrest-js` resolves with `{ data: null, error }` rather than
       * throwing, and the route never inspects `allTimeResult.error` or
       * `dailyResult.error` — only `userResult.error`. So a broken archive is
       * indistinguishable, to the caller, from a channel that has never played:
       * a 200 carrying three zeros.
       *
       * On screen that is worse than an error. `specs/channel-stats.md
       * § A failed refresh leaves the numbers alone` protects the badges by
       * treating a failed read as "no news"; a successful-looking 200 of zeros
       * is news, and a refresh that may only raise a number will keep 42 while
       * happily believing the archive said zero.
       *
       * Pinned as a canary rather than asserted as contract: when the route
       * learns to surface these errors this test fails, and the spec scenario
       * above becomes genuinely covered.
       */
      archiveHas({
        allTime: supabaseFailure(ALL_TIME, { message: 'connection reset by peer' }, {
          once: true,
          status: 500,
        }),
        daily: supabaseFailure(DAILY, { message: 'connection reset by peer' }, {
          once: true,
          status: 500,
        }),
        users: supabaseFailure(USERS, { message: 'connection reset by peer' }, {
          once: true,
          status: 500,
        }),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(NO_RECORDS);
    });
  });
});

// ===========================================================================
// specs/channel-stats.md § Open questions for the maintainer
// ===========================================================================

describe('specs/channel-stats.md — Open questions for the maintainer', () => {
  /**
   * The spec marks these ❓ Unconfirmed: they record what the code does today
   * and ask the maintainer whether that is what it should do. Nothing here is
   * asserted as contract. Where current behaviour can be pinned it is, so the
   * answer — whichever way it goes — arrives as a visible, deliberate change to
   * a test rather than as a silent drift.
   */

  describe('Scenario: a channel name written the way a streamer would type it', () => {
    // Given stats are requested for `#clarkio`
    // When WoS+ handles the request
    // Then it is rejected as an invalid channel name
    //
    // ❓ Unconfirmed — pinned as current behaviour, pending a maintainer
    // decision. Do not read the assertions below as approved contract.

    it('rejects a leading hash — unconfirmed, pending maintainer decision', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/%23clarkio',
        params: { channel: '#clarkio' },
      });

      expect(response.status).toBe(400);
      expect(await readJson<{ error: string }>(response)).toMatchObject({
        error: 'Invalid channel name format. Only lowercase letters, numbers, and underscores are allowed.',
      });
      expect(unhandledNetworkRequests()).toEqual([]);
    });

    it('is the opposite of what the same name gets when a board is recorded', () => {
      /**
       * The concrete shape of the open question: two normalisers, two answers
       * for one name a streamer plausibly types either way.
       *
       *   - reading stats     → the inline regex in `[channel].ts` rejects it
       *   - recording a board → `normalizeTwitchChannel` strips the `#` and
       *                         accepts it (see `specs/boards.md`)
       *
       * Asserted side by side so the divergence is a fact on the record rather
       * than a claim in a comment. If the maintainer unifies the two, this test
       * fails and both halves of the question get answered at once.
       */
      expect(normalizeTwitchChannel('#clarkio')).toBe('clarkio');
      expect(normalizeTwitchChannel('#ClarkIO')).toBe('clarkio');
    });
  });

  describe('Scenario: a temporary failure hides the daily badges', () => {
    // Given WoS+ is connected to a channel that has the chatbot, and the daily
    //       badges are visible
    // And the channel records briefly cannot be reached
    // When a refresh is attempted
    // Then the numbers stay as they were, but the daily badges disappear until a
    //      later refresh succeeds
    //
    // ❓ Unconfirmed. The route's half is pinned below; the view's half — that
    // the badges then vanish mid-stream — lives in `src/scripts/wos-plus-main.ts`
    // and belongs with the game-flow work.

    it('reports the chatbot as disabled on a blip, even for a channel that has it — unconfirmed, pending maintainer decision', async () => {
      // Same mechanism as "whether the channel has the chatbot cannot be
      // determined", which the spec *does* confirm. What is unconfirmed is the
      // consequence: that a one-off failure is indistinguishable from a channel
      // genuinely without the chatbot, so a transient error hides badges that
      // were legitimately on screen a second ago.
      archiveHas({
        allTime: allTimeRow(42),
        daily: dailyRow(30, 3),
        users: supabaseFailure(USERS, { message: 'connection reset by peer' }, {
          once: true,
          status: 500,
        }),
      });

      const response = await invokeRoute(GET, {
        url: '/api/channel-stats/clarkio',
        params: { channel: 'clarkio' },
      });

      expect(await readJson(response)).toMatchObject({
        // The numbers survive the blip …
        dailyBest: 30,
        dailyClears: 3,
        // … but the flag that decides whether they are shown does not.
        chatbotEnabled: false,
      });
    });

    it.todo(
      '❓ Unconfirmed: a transient failure should not hide the daily badges — ' +
      'open question: should chatbotEnabled be sticky across a failed refresh, ' +
      'the way the three numbers already are? The view half lives in ' +
      'src/scripts/wos-plus-main.ts (specs/channel-stats.md § Open questions)',
    );
  });

  describe('Scenario: the all-time best the game itself reports', () => {
    // Given WoS+ connects to a running game that reports the channel's record level
    // When the connection is made
    // Then that number is ignored, and the all-time best shown comes only from
    //      the stored channel records
    //
    // Nothing in this route can see the game's connection payload, so there is
    // no route-level half to pin. Recorded here because the question belongs to
    // this spec file.

    it.todo(
      '❓ Unconfirmed: the record level on the game connection payload is ignored — ' +
      'open question: is the code comment saying the all-time best comes from the game ' +
      'stale, or should that number be used? Lives in src/scripts/wos-plus-main.ts ' +
      '(specs/channel-stats.md § Open questions)',
    );
  });
});

// ===========================================================================
// Transport concerns for /api/channel-stats/[channel] (no spec section)
// ===========================================================================

describe('/api/channel-stats/[channel] — transport concerns (no spec section)', () => {
  /**
   * CORS is not described in `specs/channel-stats.md` — it is a transport
   * detail rather than game behaviour. Like the board routes and unlike
   * `/api/words`, this route does **not** use `getCorsOrigin` from
   * `src/lib/cors.ts`: it ships a fixed `Access-Control-Allow-Origin: *`.
   * Nothing below depends on the helper.
   */

  it('allows any origin on every answer it gives', async () => {
    archiveHas();

    const response = await invokeRoute(GET, {
      url: '/api/channel-stats/clarkio',
      params: { channel: 'clarkio' },
      headers: { origin: 'https://wosplus.com' },
    });

    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    });
  });

  it('sends CORS headers on rejections too, so a browser can read the reason', async () => {
    // A 400 with no CORS headers is opaque to a browser caller: it sees a
    // network error rather than "that channel name is invalid".
    const response = await invokeRoute(GET, {
      url: '/api/channel-stats/clark.io',
      params: { channel: 'clark.io' },
    });

    expect(response.status).toBe(400);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('*');
  });

  it('sends CORS headers on a failure too', async () => {
    silenceRouteLogging();

    const response = await invokeRoute(GET, {
      url: '/api/channel-stats/clarkio',
      params: { channel: 'clarkio' },
      workerEnv: { SUPABASE_URL: undefined, SUPABASE_KEY: undefined },
    });

    expect(response.status).toBe(500);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe('*');
  });

  it('advertises OPTIONS but exports no handler for it', async () => {
    /**
     * ⚠️ GAP, recorded not fixed — out of scope for this task.
     *
     * `Access-Control-Allow-Methods` promises `GET, OPTIONS`, but the module
     * exports no `OPTIONS` handler, so a real CORS preflight to this route falls
     * through to Astro's 404. The same gap is pinned on both board routes in
     * `boards.acceptance.test.ts`. A simple `GET` with no custom headers does
     * not preflight, so this is unreachable from the views as they are written
     * today — but the advertisement is a promise the route cannot keep, and
     * adding a handler is new behaviour needing a maintainer decision.
     *
     * Pinned as a canary: if an `OPTIONS` export is added, this fails and the
     * note above must be resolved rather than left stale.
     */
    const exportedHandlers = Object.keys(channelStatsRoute)
      .filter((name) => /^[A-Z]+$/.test(name))
      .sort();

    expect(exportedHandlers).toEqual(['GET']);
  });
});
