import { defineMiddleware } from 'astro:middleware';
import { getSession, type Session } from './lib/session';

/**
 * Paths that require authentication
 */
const PROTECTED_PATHS = ['/player', '/streamer'];

/**
 * Paths that should skip auth checks (API routes, static assets, etc.)
 */
const PUBLIC_PATHS = ['/api/auth/', '/api/health'];

/**
 * Middleware to protect routes and attach session to locals
 */
export const onRequest = defineMiddleware(async ({ request, cookies, redirect, locals }, next) => {
  const url = new URL(request.url);
  const { env } = locals.runtime;

  // Skip auth for public paths
  const isPublicPath = PUBLIC_PATHS.some((path) => url.pathname.startsWith(path));
  if (isPublicPath) {
    return next();
  }

  // Check if the path requires authentication
  const isProtectedPath = PROTECTED_PATHS.some(
    (path) => url.pathname === path || url.pathname.startsWith(path + '/')
  );

  // Try to get session if KV is available
  let session: Session | null = null;
  if (env.WOS_SESSIONS) {
    session = await getSession(env.WOS_SESSIONS, cookies);
  }

  // Attach session to locals for use in pages
  if (session) {
    locals.session = session;
  }

  // Redirect to login if accessing protected path without session
  if (isProtectedPath && !session) {
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    return redirect(`/?login=required&returnUrl=${returnUrl}`);
  }

  return next();
});
