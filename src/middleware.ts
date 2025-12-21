import { defineMiddleware } from 'astro:middleware';
import { getSessionFromKV, getSessionIdFromCookie, type Session } from './lib/session';
import { getObsSessionFromKV, obsSessionToAppSession } from './lib/obs-session';

/**
 * Paths that require authentication (redirect to login if not authenticated)
 */
const PROTECTED_PATHS = ['/player', '/streamer'];

/**
 * Paths that should skip session lookup entirely (auth routes, health checks)
 */
const SKIP_SESSION_PATHS = ['/api/auth/', '/api/health'];

/**
 * Middleware to protect routes and attach session to locals
 */
export const onRequest = defineMiddleware(async ({ request, cookies, redirect, locals }, next) => {
  const url = new URL(request.url);
  const { env } = locals.runtime;

  // Skip session lookup entirely for auth routes and health checks
  const skipSessionLookup = SKIP_SESSION_PATHS.some((path) => url.pathname.startsWith(path));
  if (skipSessionLookup) {
    return next();
  }

  // Check if the path requires authentication (will redirect if no session)
  const isProtectedPath = PROTECTED_PATHS.some(
    (path) => url.pathname === path || url.pathname.startsWith(path + '/')
  );

  // Check if this is an API path (will attach session but not redirect)
  const isApiPath = url.pathname.startsWith('/api/');

  const isStreamerPath = url.pathname === '/streamer' || url.pathname.startsWith('/streamer/');

  // Try to get session if KV is available
  let session: Session | null = null;
  const sessionId = getSessionIdFromCookie(cookies);
  if (env.WOS_SESSIONS) {
    if (sessionId) {
      // KV is eventually consistent in production; a short retry helps right after login.
      // Use fewer retries for API routes to reduce latency
      const retryDelaysMs = isApiPath ? [0, 50] : [0, 75, 150, 300];
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        session = await getSessionFromKV(env.WOS_SESSIONS, sessionId);
        if (session) {
          break;
        }
      }
    }

    // If no cookie-based session and this is /streamer, allow long-lived OBS token auth.
    if (!session && isStreamerPath) {
      const obsToken = url.searchParams.get('obs');
      if (obsToken) {
        const obsSession = await getObsSessionFromKV(env.WOS_SESSIONS, obsToken);
        if (obsSession) {
          session = obsSessionToAppSession(obsSession);
          console.log('[Auth Middleware] OBS token session accepted');
        } else {
          console.log('[Auth Middleware] OBS token invalid/expired');
        }
      }
    }

    // Only log session lookup for non-API paths to reduce noise
    if (!isApiPath) {
      console.log(
        '[Auth Middleware] Session lookup result:',
        session ? `Found user: ${session.login}` : (sessionId ? 'No session found (cookie present)' : 'No session found')
      );
    }
  } else {
    console.error('[Auth Middleware] WOS_SESSIONS KV binding is not available!');
  }

  // Attach session to locals for use in pages and API routes
  if (session) {
    locals.session = session;
  }

  // Redirect to login if accessing protected path without session
  // (API routes handle their own 401 responses, so don't redirect them)
  if (isProtectedPath && !session) {
    console.log('[Auth Middleware] Redirecting to login - protected path without session', {
      path: url.pathname,
      hasKV: !!env.WOS_SESSIONS,
      cookieHeader: request.headers.get('cookie')?.substring(0, 100) // Log first 100 chars of cookie header
    });
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    const response = redirect(`/?login=required&returnUrl=${returnUrl}`);
    // Prevent caching of the redirect response (otherwise browsers can “stick” to login_required)
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
    return response;
  }

  // For protected paths, add cache-control to prevent caching auth state
  const response = await next();
  if (isProtectedPath) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
  }
  return response;
});
