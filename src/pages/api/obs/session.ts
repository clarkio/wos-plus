export const prerender = false;

import type { APIContext } from 'astro';
import {
  buildStreamerObsUrl,
  createOrReuseObsSession,
  DEFAULT_OBS_SESSION_TTL_SECONDS,
} from '../../../lib/obs-session';

/**
 * POST /api/obs/session
 * Creates (or reuses) a long-lived OBS-friendly token for the logged-in user.
 * Returns a stable URL like /streamer?obs=<token>.
 */
export async function POST({ request, locals }: APIContext) {
  const { env } = locals.runtime;

  if (!env.WOS_SESSIONS) {
    return new Response(JSON.stringify({ error: 'KV binding WOS_SESSIONS not available' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const session = locals.session;
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  let regenerate = false;
  try {
    const body = await request.json().catch(() => ({} as any));
    regenerate = body?.regenerate === true;
  } catch {
    // ignore
  }

  // 30 days by default; enough for 48h+ streams.
  const ttlSeconds = DEFAULT_OBS_SESSION_TTL_SECONDS;

  const obsSession = await createOrReuseObsSession(
    env.WOS_SESSIONS,
    {
      userId: session.userId,
      login: session.login,
      displayName: session.displayName,
      profileImageUrl: session.profileImageUrl,
    },
    ttlSeconds,
    { regenerate }
  );

  const origin = new URL(request.url).origin;
  const url = buildStreamerObsUrl(origin, obsSession.token);

  return new Response(
    JSON.stringify({
      token: obsSession.token,
      url,
      expiresAt: obsSession.expiresAt,
      ttlSeconds,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}
