/**
 * CORS utility for API endpoints
 * Validates request origin against a whitelist of allowed origins
 */

/**
 * Parses the CORS_ALLOWED_ORIGINS environment variable
 * Expected format: comma-separated list of origins
 * Example: "https://wos-plus.pages.dev,https://wos-plus.clarkio.com"
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
 * Gets the appropriate CORS origin header based on the request origin
 * Returns the origin if it's in the whitelist, otherwise returns the first allowed origin
 */
export function getCorsOrigin(request: Request, allowedOrigins: string[]): string {
  const origin = request.headers.get('origin');

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  // For requests without an origin header (same-origin requests),
  // or requests from non-whitelisted origins, return the primary domain
  return allowedOrigins[0];
}

/**
 * Creates CORS headers for a given request
 * @param request - The incoming request
 * @param env - Environment object containing CORS_ALLOWED_ORIGINS
 */
export function getCorsHeaders(request: Request, env?: Record<string, unknown>): Record<string, string> {
  const corsOrigins = typeof env?.CORS_ALLOWED_ORIGINS === 'string' ? env.CORS_ALLOWED_ORIGINS : undefined;
  const allowedOrigins = parseAllowedOrigins(corsOrigins);
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(request, allowedOrigins),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Creates a CORS preflight response (for OPTIONS requests)
 * @param request - The incoming request
 * @param env - Environment object containing CORS_ALLOWED_ORIGINS
 */
export function createCorsPreflightResponse(request: Request, env?: Record<string, unknown>): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}
