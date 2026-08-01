/**
 * ============================================================================
 * Acceptance-test harness for WoS+ API routes
 * ============================================================================
 *
 * Astro API routes are plain functions: `(context: APIContext) => Response`.
 * This harness fabricates the `APIContext` so an acceptance test can invoke an
 * exported handler directly — no dev server, no `wrangler`, no HTTP listener —
 * and assert on the returned `Response` (status, headers, JSON body).
 *
 * ---------------------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------------------
 *
 *   // @vitest-environment node
 *   import { GET } from '../../src/pages/api/boards/[id]';
 *   import { invokeRoute, readJson } from './api-harness';
 *   import { setupNetworkMocking, supabaseSuccess } from './network-mock';
 *
 *   setupNetworkMocking();                       // see network-mock.ts
 *
 *   it('returns the stored board', async () => {
 *     server.use(supabaseSuccess('boards', { id: 'TRILBY' }));
 *     const response = await invokeRoute(GET, {
 *       url: '/api/boards/TRILBY',
 *       params: { id: 'TRILBY' },                // Astro does NOT derive these
 *     });
 *     expect(response.status).toBe(200);
 *     expect(await readJson(response)).toEqual({ id: 'TRILBY' });
 *   });
 *
 * `params` is deliberately explicit. Astro fills it from the file-based route
 * pattern at runtime; there is no pattern here, so the test states it.
 *
 * ---------------------------------------------------------------------------
 * The two places a route reads configuration from
 * ---------------------------------------------------------------------------
 *
 * 1. `locals.runtime.env` — the Cloudflare adapter's per-request env. Supply it
 *    with the `env` option.
 *
 * 2. The module-level `env` exported by `cloudflare:workers` — which is where
 *    every route in this codebase *actually* reads its Supabase credentials
 *    and `CORS_ALLOWED_ORIGINS` from. Under Vitest that specifier is aliased
 *    (in `vitest.config.ts`) to `tests/stubs/cloudflare-workers.ts`, whose
 *    `env` object is mutable. Supply it with the `workerEnv` option: values are
 *    applied for the duration of the call and restored afterwards, so a test
 *    can never leak credentials into the next one.
 *
 *    Use `setWorkerEnv` / `resetWorkerEnv` only when a change has to outlive a
 *    single `invokeRoute` call; prefer the per-call `workerEnv` option.
 *
 * ---------------------------------------------------------------------------
 * Conventions for the acceptance suite
 * ---------------------------------------------------------------------------
 *
 * - Start every acceptance test file with `// @vitest-environment node`. The
 *   repo default is happy-dom; the API routes are server code and MSW's
 *   interceptors are happiest against Node's own fetch.
 * - Name files `*.acceptance.test.ts` under `tests/acceptance/`, and cite the
 *   spec section each `describe` implements (see `specs/`).
 * - Run them with `pnpm run test:acceptance`.
 */

import type { APIContext, APIRoute } from 'astro';
// Resolved by the `cloudflare:workers` alias in vitest.config.ts, so this is
// the very same module object the routes under test import from.
import { env as workerEnvModule } from 'cloudflare:workers';

/**
 * Origin used when a test supplies a path rather than an absolute URL. It is
 * deliberately not a real domain: nothing here should ever leave the process.
 */
export const TEST_ORIGIN = 'https://wos-plus.test';

/** A mutable view of the `cloudflare:workers` env, which is a stub under test. */
type MutableEnv = Record<string, string | undefined>;
const mutableWorkerEnv = workerEnvModule as unknown as MutableEnv;

/** Snapshot of the stub's defaults, taken before any test can mutate them. */
const WORKER_ENV_DEFAULTS: Readonly<MutableEnv> = { ...mutableWorkerEnv };

/** Options describing the request, route params and environment for one call. */
export interface RouteCall {
  /** HTTP method. Defaults to `'GET'`. */
  method?: string;
  /** Path (`'/api/words'`) or absolute URL. Defaults to `'/'`. */
  url?: string;
  /** Request headers, e.g. `{ origin: 'https://wosplus.com' }`. */
  headers?: Record<string, string>;
  /** Body to send as JSON. Sets `Content-Type: application/json`. */
  json?: unknown;
  /**
   * Raw body, sent verbatim. Wins over `json`. Use this to exercise
   * malformed-payload scenarios, e.g. `body: 'not json'`.
   */
  body?: BodyInit;
  /** Route params Astro would have parsed from the file-based route pattern. */
  params?: Record<string, string | undefined>;
  /** Extra values on `context.locals`, merged over the fabricated defaults. */
  locals?: Record<string, unknown>;
  /** Values placed on `context.locals.runtime.env`. */
  env?: Record<string, string>;
  /**
   * Values applied to the module-level `env` from `cloudflare:workers` for the
   * duration of this call only, then restored. `undefined` deletes a key —
   * which is how you test a route with a credential missing.
   */
  workerEnv?: Record<string, string | undefined>;
}

/** Assigns a key, or removes it when the value is `undefined`. */
function writeEnvKey(key: string, value: string | undefined): void {
  if (value === undefined) {
    // Reflect.deleteProperty rather than `delete env[key]`: the latter trips
    // @typescript-eslint/no-dynamic-delete, which is on repo-wide.
    Reflect.deleteProperty(mutableWorkerEnv, key);
  } else {
    mutableWorkerEnv[key] = value;
  }
}

/**
 * Applies `overrides` to the `cloudflare:workers` env and returns a function
 * that puts every touched key back exactly as it was.
 */
function applyWorkerEnv(overrides: Record<string, string | undefined> | undefined): () => void {
  if (!overrides) {
    return () => { /* nothing to restore */ };
  }

  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(mutableWorkerEnv, key)
      ? mutableWorkerEnv[key]
      : undefined);
    writeEnvKey(key, value);
  }

  return () => {
    for (const [key, value] of previous) {
      writeEnvKey(key, value);
    }
  };
}

/**
 * Overwrites keys on the module-level `cloudflare:workers` env for longer than
 * a single call. Pair with `resetWorkerEnv()` in an `afterEach`. Prefer
 * `invokeRoute`'s `workerEnv` option, which cannot leak.
 */
export function setWorkerEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    writeEnvKey(key, value);
  }
}

/** Restores the `cloudflare:workers` env to the stub's declared defaults. */
export function resetWorkerEnv(): void {
  for (const key of Object.keys(mutableWorkerEnv)) {
    writeEnvKey(key, undefined);
  }
  Object.assign(mutableWorkerEnv, WORKER_ENV_DEFAULTS);
}

/** Minimal in-memory stand-in for Astro's `AstroCookies`. */
function createCookieJar(): APIContext['cookies'] {
  const jar = new Map<string, string>();
  const read = (key: string) => {
    const value = jar.get(key);
    if (value === undefined) return undefined;
    return {
      value,
      json: () => JSON.parse(value) as unknown,
      number: () => Number(value),
      boolean: () => value === 'true',
    };
  };

  return {
    get: (key: string) => read(key),
    has: (key: string) => jar.has(key),
    set: (key: string, value: unknown) => {
      jar.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: (key: string) => { jar.delete(key); },
    merge: () => { /* no-op */ },
    headers: () => [][Symbol.iterator](),
  } as unknown as APIContext['cookies'];
}

/**
 * Builds the `APIContext` an Astro route receives. Exported for the rare test
 * that needs to inspect or tweak the context before invoking a handler; most
 * tests should use `invokeRoute`.
 *
 * Only the fields the WoS+ routes actually read are fabricated faithfully
 * (`request`, `params`, `url`, `locals`, `cookies`, `redirect`). The single
 * cast below is what keeps this file free of `any`: Astro's `APIContext` has a
 * large surface that a direct-invocation test has no meaningful value for.
 */
export function createAPIContext(options: {
  request: Request;
  params?: Record<string, string | undefined>;
  locals?: Record<string, unknown>;
  env?: Record<string, string>;
}): APIContext {
  const { request, params = {}, locals = {}, env = {} } = options;
  const url = new URL(request.url);

  const context = {
    request,
    params,
    props: {},
    url,
    site: new URL(TEST_ORIGIN),
    generator: 'wos-plus acceptance harness',
    clientAddress: '127.0.0.1',
    currentLocale: undefined,
    preferredLocale: undefined,
    preferredLocaleList: undefined,
    routePattern: url.pathname,
    originPathname: url.pathname,
    isPrerendered: false,
    cookies: createCookieJar(),
    redirect: (path: string, status = 302) =>
      new Response(null, { status, headers: { Location: path } }),
    rewrite: () => {
      throw new Error('context.rewrite() is not supported by the acceptance harness');
    },
    locals: {
      // Shape produced by @astrojs/cloudflare. Routes that read
      // `locals.runtime.env` see exactly what the `env` option supplied.
      runtime: { env, cf: {}, caches: undefined, ctx: { waitUntil: () => undefined, passThroughOnException: () => undefined } },
      ...locals,
    },
  };

  return context as unknown as APIContext;
}

/**
 * Invokes an exported Astro `APIRoute` handler and returns its `Response`.
 *
 * @param handler - the route export under test, e.g. `GET`, `POST`, `PUT`, `OPTIONS`
 * @param call - request, route params and environment for this one invocation
 */
export async function invokeRoute(handler: APIRoute, call: RouteCall = {}): Promise<Response> {
  const {
    method = 'GET',
    url = '/',
    headers = {},
    json,
    body,
    params,
    locals,
    env,
    workerEnv,
  } = call;

  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    requestBody = body;
  } else if (json !== undefined) {
    requestBody = JSON.stringify(json);
    if (!requestHeaders.has('content-type')) {
      requestHeaders.set('content-type', 'application/json');
    }
  }

  const request = new Request(new URL(url, TEST_ORIGIN), {
    method,
    headers: requestHeaders,
    body: requestBody,
  });

  const context = createAPIContext({ request, params, locals, env });

  const restoreWorkerEnv = applyWorkerEnv(workerEnv);
  try {
    return await handler(context);
  } finally {
    restoreWorkerEnv();
  }
}

/**
 * Reads a response body as JSON without consuming it, so the same `Response`
 * can be read again by another assertion.
 */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  return await response.clone().json() as T;
}

/** Response headers as a plain lowercase-keyed object, for `toMatchObject`. */
export function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}
