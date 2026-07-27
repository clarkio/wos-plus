// @vitest-environment node
/**
 * ============================================================================
 * Acceptance tests for the CORS helper — `src/lib/cors.ts`
 * ============================================================================
 *
 * Spec: **none**. CORS is a transport detail rather than game behaviour, so it
 * has no section in `specs/`. This file lives in the acceptance tree anyway
 * because it is the helper *behind* the transport assertions the route
 * acceptance tests make — `words.acceptance.test.ts` pins how `/api/words`
 * wires itself to this module, and this file pins what the module itself does.
 * Read the `describe` names as the contract; there is no approved spec section
 * to cite above them.
 *
 * ---------------------------------------------------------------------------
 * Who uses this, and who does not
 * ---------------------------------------------------------------------------
 *
 * Only `/api/words` imports it. Both board routes and
 * `/api/channel-stats/[channel]` ship a hardcoded
 * `Access-Control-Allow-Origin: *` instead, so nothing in this file affects
 * them. That split is itself worth knowing: a change here reaches exactly one
 * route today.
 *
 * ---------------------------------------------------------------------------
 * The defect these tests were written for
 * ---------------------------------------------------------------------------
 *
 * `getCorsOrigin` used to end with `return allowedOrigins[0]` behind a
 * `: string` annotation. With `CORS_ALLOWED_ORIGINS` unset that is `undefined`,
 * the `Headers` constructor stringifies it, and every response advertised the
 * literal origin `"undefined"` — a header that names a nonexistent site while
 * looking, to anyone reading response headers, like configuration that worked.
 *
 * The fix omits the header entirely when no origin can be named. The tests
 * below assert **absence**, which is materially different from `'*'`: absence
 * leaves the browser's same-origin policy in force, whereas `'*'` would grant
 * every site on the internet read access on the strength of a missing
 * environment variable.
 */

import { describe, expect, it } from 'vitest';

import {
  createCorsPreflightResponse,
  getCorsHeaders,
  getCorsOrigin,
  parseAllowedOrigins,
} from '../../src/lib/cors';
import { OPTIONS } from '../../src/pages/api/words';
import { invokeRoute, responseHeaders } from './api-harness';
import { setupNetworkMocking, unhandledNetworkRequests } from './network-mock';

setupNetworkMocking();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRIMARY = 'https://wos-plus.pages.dev';
const SECONDARY = 'https://wosplus.com';
const BOTH = `${PRIMARY},${SECONDARY}`;

/** A request carrying an `Origin` header, or none at all when omitted. */
function requestFrom(origin?: string): Request {
  return new Request('https://wos-plus.test/api/words', {
    headers: origin === undefined ? {} : { origin },
  });
}

/**
 * The header value a browser would actually receive, or `undefined` when the
 * header is absent. Going through `Headers` rather than reading the plain
 * object is the point: it is `Headers` that turned the old `undefined` return
 * into the string `"undefined"`, so only this round-trip can prove the fix.
 */
function allowOriginHeader(headers: Record<string, string>): string | null {
  return new Headers(headers).get('access-control-allow-origin');
}

// ===========================================================================
// Reading the allow-list out of configuration
// ===========================================================================

describe('src/lib/cors.ts — reading the allow-list out of configuration', () => {
  describe('parseAllowedOrigins', () => {
    it('reads a single configured origin', () => {
      expect(parseAllowedOrigins(PRIMARY)).toEqual([PRIMARY]);
    });

    it('reads a comma-separated list in the order it was written', () => {
      // Order is load-bearing: the first entry is the fallback every
      // non-allowed caller is answered with.
      expect(parseAllowedOrigins(BOTH)).toEqual([PRIMARY, SECONDARY]);
    });

    it('tolerates the spacing a human leaves in an environment variable', () => {
      expect(parseAllowedOrigins(`  ${PRIMARY} ,\t${SECONDARY}  `)).toEqual([PRIMARY, SECONDARY]);
    });

    it('drops empty entries left by a stray or trailing comma', () => {
      expect(parseAllowedOrigins(`${PRIMARY},,${SECONDARY},`)).toEqual([PRIMARY, SECONDARY]);
      expect(parseAllowedOrigins(`,${PRIMARY}`)).toEqual([PRIMARY]);
    });

    it('keeps one copy of an origin listed twice', () => {
      // A duplicate must not shift the fallback or bloat the list; the first
      // occurrence keeps its position.
      expect(parseAllowedOrigins(`${PRIMARY},${SECONDARY},${PRIMARY}`))
        .toEqual([PRIMARY, SECONDARY]);
    });

    it('folds a list that is entirely duplicates down to one origin', () => {
      expect(parseAllowedOrigins(`${PRIMARY},${PRIMARY},${PRIMARY}`)).toEqual([PRIMARY]);
    });

    it('treats whitespace around a duplicate as the same origin', () => {
      expect(parseAllowedOrigins(`${PRIMARY}, ${PRIMARY} `)).toEqual([PRIMARY]);
    });

    it.each([
      ['nothing configured', undefined],
      ['an empty value', ''],
      ['a value that is only spacing', '   '],
      ['a value that is only separators', '  ,  ,'],
    ])('reads %s as an empty allow-list', (_label, value) => {
      expect(parseAllowedOrigins(value)).toEqual([]);
    });

    it('does not validate the origins it is given', () => {
      // Deliberate: the allow-list is operator-supplied configuration, not user
      // input, and silently dropping an entry that looked malformed would be a
      // worse failure than passing it through for a browser to reject.
      expect(parseAllowedOrigins('not-a-url,http://localhost:4321'))
        .toEqual(['not-a-url', 'http://localhost:4321']);
    });
  });
});

// ===========================================================================
// Choosing the origin to answer a caller with
// ===========================================================================

describe('src/lib/cors.ts — choosing the origin to answer a caller with', () => {
  describe('getCorsOrigin', () => {
    it('echoes the callers own origin when it is on the allow-list', () => {
      const allowed = parseAllowedOrigins(BOTH);

      expect(getCorsOrigin(requestFrom(SECONDARY), allowed)).toBe(SECONDARY);
      expect(getCorsOrigin(requestFrom(PRIMARY), allowed)).toBe(PRIMARY);
    });

    it('matches an allowed origin exactly, not loosely', () => {
      // A prefix or suffix match would let `https://wosplus.com.evil.test`
      // through, so the comparison is whole-string.
      const allowed = parseAllowedOrigins(SECONDARY);

      expect(getCorsOrigin(requestFrom('https://wosplus.com.evil.test'), allowed)).toBe(SECONDARY);
      expect(getCorsOrigin(requestFrom('https://evil.test/?x=https://wosplus.com'), allowed))
        .toBe(SECONDARY);
      expect(getCorsOrigin(requestFrom('http://wosplus.com'), allowed)).toBe(SECONDARY);
    });

    it('falls back to the primary configured origin for a caller from elsewhere', () => {
      // The caller is not granted access: a browser compares this value against
      // its own origin and blocks the read. Naming the primary domain rather
      // than the caller is what makes that comparison fail.
      expect(getCorsOrigin(requestFrom('https://not-allowed.example'), parseAllowedOrigins(BOTH)))
        .toBe(PRIMARY);
    });

    it('falls back to the primary configured origin when the request carries no origin at all', () => {
      // Same-origin and server-to-server callers send no `Origin` header and do
      // not need CORS; they get the primary domain and ignore it.
      expect(getCorsOrigin(requestFrom(), parseAllowedOrigins(BOTH))).toBe(PRIMARY);
    });

    it('names no origin when nothing is configured', () => {
      /**
       * The defect this file was written for. `allowedOrigins[0]` on an empty
       * list is `undefined`, and the declared return type used to say `string`,
       * so the value flowed into `Headers` and became the literal `"undefined"`.
       *
       * Returning `undefined` — and omitting the header, see `getCorsHeaders`
       * below — is the conservative answer. `'*'` would be a security decision
       * taken by a missing environment variable.
       */
      expect(getCorsOrigin(requestFrom(SECONDARY), [])).toBeUndefined();
      expect(getCorsOrigin(requestFrom(), [])).toBeUndefined();
    });

    it('never invents an origin the operator did not configure', () => {
      // Whatever comes back is either the caller's own origin or one from the
      // list — never a wildcard, and never a value derived from the request.
      const allowed = parseAllowedOrigins(BOTH);

      for (const origin of [PRIMARY, SECONDARY, 'https://evil.test', undefined]) {
        const chosen = getCorsOrigin(requestFrom(origin), allowed);
        expect(chosen).not.toBe('*');
        expect(allowed).toContain(chosen);
      }
    });
  });
});

// ===========================================================================
// Building the header set a route sends
// ===========================================================================

describe('src/lib/cors.ts — building the header set a route sends', () => {
  describe('getCorsHeaders', () => {
    it('names the caller and the methods the route accepts', () => {
      const headers = getCorsHeaders(requestFrom(SECONDARY), { CORS_ALLOWED_ORIGINS: BOTH });

      expect(headers).toEqual({
        'Access-Control-Allow-Origin': SECONDARY,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
    });

    it('sends the same methods, headers and max-age whoever is asking', () => {
      // Only the origin varies with the caller; everything else is fixed, so a
      // rejected caller still learns what the route would accept.
      const rejected = getCorsHeaders(requestFrom('https://evil.test'), {
        CORS_ALLOWED_ORIGINS: BOTH,
      });

      expect(rejected).toMatchObject({
        'Access-Control-Allow-Origin': PRIMARY,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
    });

    it.each([
      ['nothing configured', undefined],
      ['an empty value', ''],
      ['a value that is only spacing', '   '],
    ])('omits the origin header entirely, rather than sending one named "undefined", given %s',
      (_label, configured) => {
        /**
         * The regression test for the defect. Before the fix this header was
         * present with the literal value `"undefined"`.
         *
         * Absence is deliberate and is *not* the same as `'*'`: with no header
         * the browser applies the same-origin policy and a cross-origin read is
         * blocked, which is the correct outcome for an allow-list nobody
         * configured. `'*'` would open the route to every site on the internet.
         */
        const headers = getCorsHeaders(requestFrom(SECONDARY), {
          CORS_ALLOWED_ORIGINS: configured,
        });

        expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
        expect(allowOriginHeader(headers)).toBeNull();
        expect(allowOriginHeader(headers)).not.toBe('undefined');

        // The rest of the set still goes out, so the route keeps working and
        // only the origin grant is withheld.
        expect(headers).toEqual({
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        });
      });

    it('omits the origin header when no environment is passed at all', () => {
      expect(getCorsHeaders(requestFrom(SECONDARY))).not.toHaveProperty('Access-Control-Allow-Origin');
    });

    it.each([
      ['a number', 42],
      ['a null', null],
      ['a list', ['https://wosplus.com']],
      ['an object', { primary: 'https://wosplus.com' }],
      ['a boolean', true],
    ])('ignores a CORS_ALLOWED_ORIGINS that is %s rather than text', (_label, configured) => {
      // A binding of the wrong type is a misconfiguration, and is treated the
      // same as an absent one: no origin is granted, and nothing throws.
      const headers = getCorsHeaders(requestFrom(SECONDARY), {
        CORS_ALLOWED_ORIGINS: configured,
      });

      expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    });

    it('produces headers a Response accepts without complaint', () => {
      // The end of the chain the defect travelled down: a plain object handed
      // to `Response`. This is where `undefined` used to become `"undefined"`.
      const response = new Response(null, {
        headers: getCorsHeaders(requestFrom(SECONDARY), { CORS_ALLOWED_ORIGINS: undefined }),
      });

      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    });
  });

  describe('createCorsPreflightResponse', () => {
    it('answers a preflight with no content and the full header set', () => {
      const response = createCorsPreflightResponse(requestFrom(SECONDARY), {
        CORS_ALLOWED_ORIGINS: BOTH,
      });

      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
      expect(responseHeaders(response)).toMatchObject({
        'access-control-allow-origin': SECONDARY,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
        'access-control-max-age': '86400',
      });
    });

    it('answers a preflight without an origin grant when nothing is configured', () => {
      const response = createCorsPreflightResponse(requestFrom(SECONDARY));

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});

// ===========================================================================
// The one route that uses the helper
// ===========================================================================

describe('src/lib/cors.ts — as /api/words actually serves it', () => {
  /**
   * Proves the fix survives the trip through a real route and a real
   * `Response`, which is the only place the old `"undefined"` was visible.
   * `OPTIONS` is used because it reaches no database, so these assertions are
   * about CORS and nothing else — the harness `afterEach` fails the test if any
   * request escapes.
   */

  it('grants the callers own origin on a preflight when it is allowed', async () => {
    const response = await invokeRoute(OPTIONS, {
      method: 'OPTIONS',
      url: '/api/words',
      headers: { origin: SECONDARY },
      workerEnv: { CORS_ALLOWED_ORIGINS: BOTH },
    });

    expect(response.status).toBe(204);
    expect(responseHeaders(response)['access-control-allow-origin']).toBe(SECONDARY);
    expect(unhandledNetworkRequests()).toEqual([]);
  });

  it('sends no origin grant on a preflight when CORS is misconfigured', async () => {
    const response = await invokeRoute(OPTIONS, {
      method: 'OPTIONS',
      url: '/api/words',
      headers: { origin: SECONDARY },
      workerEnv: { CORS_ALLOWED_ORIGINS: undefined },
    });

    // Previously: `access-control-allow-origin: undefined`.
    expect(response.status).toBe(204);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    // The preflight still answers, so the misconfiguration surfaces as a
    // blocked cross-origin read rather than as a broken endpoint.
    expect(responseHeaders(response)['access-control-allow-methods']).toBe('GET, OPTIONS');
    expect(unhandledNetworkRequests()).toEqual([]);
  });
});
