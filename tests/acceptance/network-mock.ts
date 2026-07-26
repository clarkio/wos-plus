/**
 * ============================================================================
 * Network boundary for the acceptance suite (MSW)
 * ============================================================================
 *
 * The acceptance tests exercise the *real* `@supabase/supabase-js` client —
 * its query building, its header handling, its error mapping. Only the HTTP
 * boundary is faked. Nothing here mocks a module: if you find yourself reaching
 * for `vi.mock('@supabase/supabase-js')`, stop, because that would stop testing
 * the code this suite exists to test.
 *
 * ---------------------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------------------
 *
 *   // @vitest-environment node
 *   import { server, setupNetworkMocking, supabaseSuccess } from './network-mock';
 *
 *   setupNetworkMocking();     // once per file, at the top level
 *
 *   it('...', async () => {
 *     server.use(supabaseSuccess('boards', [{ id: 'TRILBY' }]));
 *     ...
 *   });
 *
 * Handlers registered with `server.use(...)` are reset after every test.
 *
 * ---------------------------------------------------------------------------
 * No test may reach the real network
 * ---------------------------------------------------------------------------
 *
 * A request with no matching handler is (1) answered locally so it never leaves
 * the process, and (2) recorded, with the recording asserted empty after every
 * test. Three mechanisms, because two of them are individually insufficient:
 *
 * 1. `onUnhandledRequest: 'error'` — configured, and it does log. But in
 *    msw 2.15.0 it does NOT stop the request: the throw from `print.error()`
 *    is swallowed inside MSW's async frame listener and the request proceeds to
 *    the real network. Verified against a local HTTP server, which received the
 *    unmatched request and whose response body came back to the caller. Treat
 *    this option as a log line, not a guard.
 *
 * 2. `blockUnmatchedRequests` — a catch-all handler registered as an *initial*
 *    handler, so it survives `resetHandlers()` while anything added with
 *    `server.use()` takes precedence over it. This is what actually keeps the
 *    network out of reach: it answers 501 locally. It is deliberately not a
 *    simulated network error, because a rejected `fetch` sends `postgrest-js`
 *    into three retries with 1s/2s/4s backoff, blowing Vitest's 5s timeout
 *    before the assertion below can explain what went wrong.
 *
 * 3. The recorder + `afterEach` assertion — because every route under test
 *    wraps Supabase in `try/catch` and turns any failure into a 500. Without
 *    this, a test asserting "Supabase failed ⇒ 500" would pass while quietly
 *    depending on a missing handler. The assertion fails the test loudly and
 *    names the URL.
 *
 * ---------------------------------------------------------------------------
 * Declaring Supabase responses
 * ---------------------------------------------------------------------------
 *
 * `supabaseSuccess(table, body, options?)`  — a 2xx PostgREST response.
 * `supabaseFailure(table, error, options?)` — a PostgREST error response.
 * `supabaseNoRows(table, options?)`         — the `.single()`-found-nothing case.
 *
 * `table` is the PostgREST table name, i.e. what the route passes to
 * `.from(...)`: `'boards'`, `'words'`, `'users'`,
 * `'wos_channel_all_time_records'`, `'wos_channel_daily_achievements'`.
 * Handlers match on any host, so the credentials a test sets are irrelevant to
 * matching.
 *
 * `body` is returned verbatim, so it must match the shape the client expects:
 * an **array** for a plain `.select()`, a bare **object** for `.single()`.
 *
 * Useful options:
 *   `method`    — `'get'` (default), `'post'`, `'patch'`, `'put'`, `'delete'`, `'head'`.
 *                 Supabase maps `.insert()` to POST and `.update()` to PATCH.
 *   `once`      — consume the handler after one request. Chain several `once`
 *                 handlers for the same table to script a sequence, which is
 *                 how `/api/words` pagination is driven.
 *   `onRequest` — inspect the outgoing `Request` the real client built: its
 *                 POST body, its `?id=eq.…` filter, the `?offset=…&limit=…`
 *                 that `.range()` produces, or the
 *                 `Accept: application/vnd.pgrst.object+json` that marks a
 *                 `.single()`.
 *   `status`    — override the response status. Never use 503 or 520:
 *                 `postgrest-js` treats those as retryable and will re-send.
 *
 * Example — the whole of `/api/channel-stats/[channel]`'s happy path:
 *
 *   server.use(
 *     supabaseSuccess('wos_channel_all_time_records', { all_time_highest_level_reached: 42 }),
 *     supabaseSuccess('wos_channel_daily_achievements', { highest_level_reached: 12, board_clears: 3 }),
 *     supabaseSuccess('users', [{ twitch_username: 'clarkio' }]),
 *   );
 *
 * Example — a duplicate-board insert:
 *
 *   server.use(supabaseFailure('boards',
 *     { code: '23505', message: 'duplicate key value violates unique constraint' },
 *     { method: 'post', status: 409 }));
 */

import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';

let unhandled: string[] = [];

function record(request: Request): void {
  unhandled.push(`${request.method} ${request.url}`);
}

/**
 * Catch-all fallback: answers any request no other handler claimed, so nothing
 * ever reaches the real network. Registered as an initial handler, which means
 * `server.resetHandlers()` keeps it and `server.use(...)` outranks it.
 */
const blockUnmatchedRequests = http.all('*', ({ request }) => {
  record(request);
  return HttpResponse.json(
    { error: 'Blocked by the WoS+ acceptance harness: no MSW handler matched this request.' },
    { status: 501 },
  );
});

/** The shared MSW server. Register per-test handlers with `server.use(...)`. */
export const server = setupServer(blockUnmatchedRequests);

/** Requests seen with no matching handler since the current test began. */
export function unhandledNetworkRequests(): readonly string[] {
  return [...unhandled];
}

/**
 * Wires the MSW server into a test file's lifecycle: listen, refuse and record
 * unmatched requests, reset handlers between tests, close at the end.
 *
 * Call once at the top level of every acceptance test file.
 */
export function setupNetworkMocking(): void {
  beforeAll(() => {
    server.listen({
      // MSW's `'error'` strategy plus a recording. In practice
      // `blockUnmatchedRequests` claims everything first, so this only fires if
      // that catch-all ever stops matching — a deliberate second line of
      // defence, not the primary guard. See the header comment.
      onUnhandledRequest(request, print) {
        record(request);
        print.error();
      },
    });
  });

  afterEach(() => {
    server.resetHandlers();
    const attempted = unhandled;
    unhandled = [];
    if (attempted.length > 0) {
      throw new Error(
        'Acceptance tests must not make unmatched network requests. ' +
        'No MSW handler matched:\n  ' + attempted.join('\n  ') +
        '\nRegister one with server.use(supabaseSuccess(...)) or supabaseFailure(...).'
      );
    }
  });

  afterAll(() => {
    server.close();
  });
}

/** HTTP verbs a Supabase/PostgREST call can use. */
export type SupabaseMethod = 'get' | 'post' | 'patch' | 'put' | 'delete' | 'head';

/** Shared options for the Supabase response helpers. */
export interface SupabaseResponseOptions {
  /** Defaults to `'get'`. `.insert()` is `'post'`; `.update()` is `'patch'`. */
  method?: SupabaseMethod;
  /** Override the response status. Avoid 503/520 — postgrest-js retries those. */
  status?: number;
  /** Consume this handler after a single matching request. */
  once?: boolean;
  /** Extra response headers, e.g. `{ 'content-range': '0-999/2500' }`. */
  headers?: Record<string, string>;
  /** Inspect the outgoing request — assert its body, headers or query string. */
  onRequest?: (request: Request) => void | Promise<void>;
}

/** PostgREST matches on the path only, so any Supabase host will do. */
function restPath(table: string): string {
  return `*/rest/v1/${table}`;
}

function handlerFor(
  table: string,
  options: SupabaseResponseOptions,
  respond: () => Response,
): HttpHandler {
  const { method = 'get', once = false, onRequest } = options;
  return http[method](
    restPath(table),
    async ({ request }) => {
      await onRequest?.(request);
      return respond();
    },
    { once },
  );
}

/**
 * A successful PostgREST response for `table`.
 *
 * @param body - returned verbatim: an array for `.select()`, an object for `.single()`
 */
export function supabaseSuccess(
  table: string,
  body: JsonBodyType,
  options: SupabaseResponseOptions = {},
): HttpHandler {
  const { status = 200, headers } = options;
  return handlerFor(table, options, () => HttpResponse.json(body, { status, headers }));
}

/** The error body PostgREST returns; `postgrest-js` surfaces it as `error`. */
export interface SupabaseErrorBody {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * A PostgREST error response for `table`. Defaults to status 400; pass the
 * status the real database would use (409 for a unique-constraint violation,
 * 500 for a server fault).
 */
export function supabaseFailure(
  table: string,
  error: SupabaseErrorBody,
  options: SupabaseResponseOptions = {},
): HttpHandler {
  const { status = 400, headers } = options;
  const body = { code: '', details: null, hint: null, ...error };
  return handlerFor(table, options, () => HttpResponse.json(body, { status, headers }));
}

/**
 * The response PostgREST gives a `.single()` query that matched no rows —
 * error code `PGRST116`, which the board and channel-stats routes special-case
 * into a 404 or a zeroed record.
 */
export function supabaseNoRows(
  table: string,
  options: SupabaseResponseOptions = {},
): HttpHandler {
  return supabaseFailure(
    table,
    {
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      hint: null,
      message: 'JSON object requested, multiple (or no) rows returned',
    },
    { status: 406, ...options },
  );
}
