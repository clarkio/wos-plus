export const prerender = false;

import type { APIContext } from 'astro';
import { createTwitchClient, getTwitchUser } from '../../../lib/twitch-oauth';
import { createSession, setSessionCookie } from '../../../lib/session';

const STATE_COOKIE_NAME = 'twitch_oauth_state';
const RETURN_URL_COOKIE_NAME = 'auth_return_url';

/**
 * GET /api/auth/callback
 * Handles the OAuth callback from Twitch, exchanges code for tokens,
 * fetches user info, and creates a session
 */
export async function GET({ request, redirect, cookies, locals }: APIContext) {
  const { env } = locals.runtime;
  const url = new URL(request.url);
  const isSecure = url.protocol === 'https:';

  // Extract OAuth parameters
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Get stored state and return URL from cookies
  const storedState = cookies.get(STATE_COOKIE_NAME)?.value;
  const returnUrl = cookies.get(RETURN_URL_COOKIE_NAME)?.value || '/player';

  // Clear OAuth cookies
  cookies.delete(STATE_COOKIE_NAME, { path: '/' });
  cookies.delete(RETURN_URL_COOKIE_NAME, { path: '/' });

  // Handle OAuth errors from Twitch
  if (error) {
    console.error('Twitch OAuth error:', error, errorDescription);
    return redirect(`/?error=auth_denied&message=${encodeURIComponent(errorDescription || error)}`);
  }

  // Validate state to prevent CSRF attacks
  if (!code || !state || state !== storedState) {
    console.error('Invalid OAuth state', { hasCode: !!code, hasState: !!state, stateMatch: state === storedState });
    return redirect('/?error=invalid_state');
  }

  // Get Twitch configuration
  const clientId = env.TWITCH_CLIENT_ID;
  const clientSecret = env.TWITCH_CLIENT_SECRET;
  const redirectUri = env.TWITCH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Missing Twitch OAuth configuration');
    return redirect('/?error=server_error');
  }

  try {
    // Create Twitch client and exchange code for tokens
    const twitch = createTwitchClient(clientId, clientSecret, redirectUri);
    const tokens = await twitch.validateAuthorizationCode(code);

    // Get access token and expiration
    const accessToken = tokens.accessToken();
    const refreshToken = tokens.refreshToken();
    const expiresInSeconds = tokens.accessTokenExpiresInSeconds();

    // Fetch user profile from Twitch
    const user = await getTwitchUser(accessToken, clientId);

    // Create session data
    const sessionData = {
      userId: user.id,
      login: user.login,
      displayName: user.displayName,
      profileImageUrl: user.profileImageUrl,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };

    // Store session in Cloudflare KV
    const sessionId = await createSession(env.WOS_SESSIONS, sessionData, expiresInSeconds);

    // Set session cookie (isSecure=false for localhost development)
    setSessionCookie(cookies, sessionId, expiresInSeconds, isSecure);

    console.log(`User ${user.login} authenticated successfully`);

    // Redirect to the original destination with success indicator
    const separator = returnUrl.includes('?') ? '&' : '?';
    return redirect(`${returnUrl}${separator}login_success=true`);
  } catch (err) {
    console.error('Auth callback error:', err);
    return redirect('/?error=auth_failed');
  }
}
