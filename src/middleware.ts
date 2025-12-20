import { defineMiddleware } from 'astro:middleware';
import { getCurrentUser } from './lib/auth';

// Routes that require authentication
const PROTECTED_ROUTES = ['/player', '/streamer'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request, locals, redirect } = context;
  const pathname = url.pathname;

  // Check if this is a protected route
  const isProtectedRoute = PROTECTED_ROUTES.some(route =>
    pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isProtectedRoute) {
    const { env } = locals.runtime;
    const jwtSecret = env.JWT_SECRET;

    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return redirect('/signin?error=config_error');
    }

    const user = await getCurrentUser(request, jwtSecret);

    if (!user) {
      // Not authenticated, redirect to sign-in
      return redirect(`/signin?redirect=${encodeURIComponent(pathname + url.search)}`);
    }

    // Store user in locals for use in pages
    locals.user = user;
  }

  return next();
});
