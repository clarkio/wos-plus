export const prerender = false;

import type { APIContext } from 'astro';
import { createTwitchClient, getTwitchUser } from '../../../lib/twitch-oauth';
import { createSession, setSessionCookie, clearSessionCookie } from '../../../lib/session';

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
  const rawReturnUrl = cookies.get(RETURN_URL_COOKIE_NAME)?.value || '/player';

  // Normalize returnUrl so we only ever redirect to an internal path.
  // This also guards against accidentally persisting '/?login=required&returnUrl=...' as the return URL.
  let returnUrl = rawReturnUrl;
  try {
    const parsed = new URL(rawReturnUrl, 'https://example.invalid');

    // If we somehow stored the login-required landing URL, extract the real returnUrl.
    if (parsed.pathname === '/' && parsed.searchParams.get('login') === 'required') {
      const embeddedReturnUrl = parsed.searchParams.get('returnUrl');
      if (embeddedReturnUrl) {
        returnUrl = embeddedReturnUrl;
      }
    }
  } catch {
    // ignore
  }

  if (!returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
    returnUrl = '/player';
  }

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
    console.log(`[Auth Callback] Session created in KV with ID: ${sessionId.substring(0, 8)}...`);

    // Defensive: clear any legacy path-scoped session cookies so the new cookie
    // works consistently across '/', '/player', and '/streamer'.
    clearSessionCookie(cookies);

    // Set session cookie (isSecure=false for localhost development)
    setSessionCookie(cookies, sessionId, expiresInSeconds, isSecure);
    console.log(`[Auth Callback] Session cookie set, isSecure: ${isSecure}`);

    console.log(`[Auth Callback] User ${user.login} authenticated successfully, redirecting to: ${returnUrl}`);

    // Redirect to the original destination with success indicator
    // Ensure trailing slash to avoid 307 redirect stripping query params
    let finalUrl = returnUrl;
    if (!finalUrl.includes('?') && !finalUrl.endsWith('/')) {
      finalUrl = finalUrl + '/';
    }
    const separator = finalUrl.includes('?') ? '&' : '?';
    return redirect(`${finalUrl}${separator}login_success=true`);
  } catch (err) {
    console.error('Auth callback error:', err);
    return redirect('/?error=auth_failed');
  }
}
