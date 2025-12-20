import type { APIRoute } from 'astro';
export const prerender = false;

interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
}

interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  email?: string;
  profile_image_url: string;
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TwitchTokenResponse> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to exchange code for token');
  }

  return response.json();
}

async function getTwitchUser(accessToken: string, clientId: string): Promise<TwitchUser> {
  const response = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Twitch user');
  }

  const data = await response.json();
  return data.data[0];
}

async function createSessionToken(user: TwitchUser, secret: string): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    sub: user.id,
    username: user.login,
    display_name: user.display_name,
    email: user.email,
    profile_image_url: user.profile_image_url,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
  };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signatureB64}`;
}

export const GET: APIRoute = async ({ url, request, locals, redirect }) => {
  const { env } = locals.runtime;

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return redirect('/signin?error=invalid_request');
  }

  // Verify state from cookie
  const cookies = request.headers.get('cookie') || '';
  const stateCookie = cookies
    .split(';')
    .find(c => c.trim().startsWith('twitch_oauth_state='))
    ?.split('=')[1];

  if (!stateCookie || stateCookie !== state) {
    return redirect('/signin?error=invalid_state');
  }

  try {
    const clientId = env.TWITCH_CLIENT_ID;
    const clientSecret = env.TWITCH_CLIENT_SECRET;
    const redirectUri = env.TWITCH_REDIRECT_URI;
    const jwtSecret = env.JWT_SECRET;

    if (!clientId || !clientSecret || !redirectUri || !jwtSecret) {
      throw new Error('Missing OAuth configuration');
    }

    // Exchange code for access token
    const tokenData = await exchangeCodeForToken(code, clientId, clientSecret, redirectUri);

    // Get user info from Twitch
    const user = await getTwitchUser(tokenData.access_token, clientId);

    // Create session token
    const sessionToken = await createSessionToken(user, jwtSecret);

    // Set session cookie and redirect
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/player',
        'Set-Cookie': [
          `twitch_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
          `twitch_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, // Clear state cookie
        ].join(', '),
      },
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return redirect('/signin?error=authentication_failed');
  }
};
