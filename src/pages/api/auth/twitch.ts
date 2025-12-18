export const prerender = false;

import type { APIContext } from 'astro';
import { generateState } from 'arctic';
import { createTwitchClient } from '../../../lib/twitch-oauth';

const STATE_COOKIE_NAME = 'twitch_oauth_state';
const RETURN_URL_COOKIE_NAME = 'auth_return_url';

/**
 * GET /api/auth/twitch
 * Initiates the Twitch OAuth flow by redirecting to Twitch's authorization page
 */
export async function GET({ request, redirect, cookies, locals }: APIContext) {
  const { env } = locals.runtime;
  const url = new URL(request.url);
  const isSecure = url.protocol === 'https:';

  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  const redirectUri = env.TWITCH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Missing Twitch OAuth configuration');
    return new Response('Server configuration error', { status: 500 });
  }

  // Check for return URL in query params
  const returnUrl = url.searchParams.get('returnUrl') || '/player';

  // Create Twitch client and generate state for CSRF protection
  const twitch = createTwitchClient(clientId, clientSecret, redirectUri);
  const state = generateState();

  // Generate authorization URL with required scopes
  const scopes = ['user:read:email'];
  const authUrl = twitch.createAuthorizationURL(state, scopes);

  // Store state in cookie for verification in callback
  cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });

  // Store return URL for redirect after auth
  cookies.set(RETURN_URL_COOKIE_NAME, returnUrl, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });

  return redirect(authUrl.toString());
}
