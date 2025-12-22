export const prerender = false;

import type { APIContext } from 'astro';
import {
  getSessionIdFromCookie,
  deleteSession,
  clearSessionCookie,
} from '../../../lib/session';

/**
 * GET /api/auth/logout
 * Clears the user session from KV and removes the session cookie
 */
export async function GET({ redirect, cookies, locals }: APIContext) {
  const { env } = locals.runtime;

  // Get current session ID
  const sessionId = getSessionIdFromCookie(cookies);

  // Delete session from KV if it exists
  if (sessionId && env.WOS_SESSIONS) {
    try {
      await deleteSession(env.WOS_SESSIONS, sessionId);
      console.log('Session deleted from KV');
    } catch (err) {
      console.error('Error deleting session from KV:', err);
      // Continue with logout even if KV delete fails
    }
  }

  // Clear the session cookie
  clearSessionCookie(cookies);

  // Redirect to home page
  return redirect('/');
}
