import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = async ({ locals, redirect }) => {
  const { env } = locals.runtime;

  const clientId = env.TWITCH_CLIENT_ID;
  const redirectUri = env.TWITCH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return new Response('Missing Twitch OAuth configuration', { status: 500 });
  }

  // Generate random state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in cookie for verification
  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'user:read:email');
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authUrl.toString(),
      'Set-Cookie': `twitch_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    }
  });
};
