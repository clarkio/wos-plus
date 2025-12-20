export interface SessionUser {
  sub: string;
  username: string;
  display_name: string;
  email?: string;
  profile_image_url: string;
  iat: number;
  exp: number;
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionUser | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    // Verify signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Convert base64url to ArrayBuffer
    const signatureBytes = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - signatureB64.length % 4) % 4)),
      c => c.charCodeAt(0)
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(data)
    );

    if (!isValid) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    ) as SessionUser;

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('Error verifying session token:', error);
    return null;
  }
}

export function getSessionFromRequest(request: Request): string | null {
  const cookies = request.headers.get('cookie') || '';
  const sessionCookie = cookies
    .split(';')
    .find(c => c.trim().startsWith('twitch_session='))
    ?.split('=')[1];

  return sessionCookie || null;
}

export async function getCurrentUser(
  request: Request,
  jwtSecret: string
): Promise<SessionUser | null> {
  const token = getSessionFromRequest(request);
  if (!token) {
    return null;
  }

  return verifySessionToken(token, jwtSecret);
}
