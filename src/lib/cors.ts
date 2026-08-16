type CorsEnv = {
  CORS_ALLOWED_ORIGINS?: unknown;
};

/**
 * CORS utility for API endpoints
 * Validates request origin against a whitelist of allowed origins
 */

/**
 * Parses the CORS_ALLOWED_ORIGINS environment variable
 * Expected format: comma-separated list of origins
 * Example: "https://wos-plus.pages.dev,https://wosplus.com"
 */
export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') {
    return [];
  }

  const origins = envValue
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);

  return [...new Set([...origins])];
}

/**
 * Gets the appropriate CORS origin header based on the request origin.
 *
 * Returns the caller's own origin when it is on the whitelist, otherwise the
 * primary (first) allowed origin — and `undefined` when no origins are
 * configured at all, meaning there is no origin to name and the caller should
 * omit the header entirely.
 *
 * The `undefined` case is deliberate. This function used to be annotated
 * `: string` while ending in `allowedOrigins[0]`, which is `undefined` on an
 * empty list — a lie the compiler accepts only because
 * `noUncheckedIndexedAccess` is off. The value flowed into the `Headers`
 * constructor, which stringifies it, so with `CORS_ALLOWED_ORIGINS` unset every
 * response advertised the literal origin `"undefined"`.
 *
 * Omitting the header is the conservative repair. With no header the browser
 * applies its same-origin policy and blocks the cross-origin read, which is the
 * right outcome for an allow-list nobody configured, and the response body is
 * still served normally to same-origin and server-side callers. Returning `'*'`
 * instead would be a genuine security decision — every site on the internet
 * granted read access on the strength of a missing environment variable — and
 * that belongs in configuration, not in a fallback. Returning `''` was rejected
 * too: it still ships a header, one that matches nothing and explains nothing.
 */
export function getCorsOrigin(request: Request, allowedOrigins: string[]): string | undefined {
  const origin = request.headers.get('origin');

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  // For requests without an origin header (same-origin requests),
  // or requests from non-whitelisted origins, return the primary domain.
  // Undefined when the whitelist is empty; see the note above.
  return allowedOrigins[0];
}

/**
 * Creates CORS headers for a given request
 * @param request - The incoming request
 * @param env - Environment object containing CORS_ALLOWED_ORIGINS
 * @param allowedMethods - HTTP methods the route accepts
 */
export function getCorsHeaders(
  request: Request,
  env?: CorsEnv,
  allowedMethods: readonly string[] = ['GET', 'OPTIONS'],
): Record<string, string> {
  const corsOrigins = typeof env?.CORS_ALLOWED_ORIGINS === 'string' ? env.CORS_ALLOWED_ORIGINS : undefined;
  const allowedOrigins = parseAllowedOrigins(corsOrigins);
  const allowOrigin = getCorsOrigin(request, allowedOrigins);
  return {
    // Spread rather than assigned, so that with no configured origins the key
    // is absent instead of carrying the string "undefined". See getCorsOrigin.
    ...(allowOrigin === undefined ? {} : { 'Access-Control-Allow-Origin': allowOrigin }),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': allowedMethods.join(', '),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Creates a CORS preflight response (for OPTIONS requests)
 * @param request - The incoming request
 * @param env - Environment object containing CORS_ALLOWED_ORIGINS
 * @param allowedMethods - HTTP methods the route accepts
 */
export function createCorsPreflightResponse(
  request: Request,
  env?: CorsEnv,
  allowedMethods?: readonly string[],
): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env, allowedMethods),
  });
}
