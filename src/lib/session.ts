/// <reference types="@cloudflare/workers-types" />

import type { AstroCookies } from 'astro';

/**
 * Session data stored in Cloudflare KV
 */
export interface Session {
  userId: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Public session data (safe to expose to client)
 */
export interface PublicSession {
  userId: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}

const SESSION_COOKIE_NAME = 'wos_session';
const SESSION_PREFIX = 'session:';

/**
 * Generates a secure random session ID
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Creates a new session in Cloudflare KV
 * @param kv - Cloudflare KV namespace
 * @param session - Session data to store
 * @param ttlSeconds - Time to live in seconds
 * @returns The generated session ID
 */
export async function createSession(
  kv: KVNamespace,
  session: Session,
  ttlSeconds: number
): Promise<string> {
  const sessionId = generateSessionId();

  await kv.put(
    `${SESSION_PREFIX}${sessionId}`,
    JSON.stringify(session),
    { expirationTtl: Math.max(ttlSeconds, 60) } // Minimum 60 seconds
  );

  return sessionId;
}

/**
 * Retrieves a session from Cloudflare KV
 * @param kv - Cloudflare KV namespace
 * @param sessionId - The session ID to look up
 * @returns The session data or null if not found/expired
 */
export async function getSessionFromKV(
  kv: KVNamespace,
  sessionId: string | undefined
): Promise<Session | null> {
  if (!sessionId) {
    return null;
  }

  try {
    const data = await kv.get(`${SESSION_PREFIX}${sessionId}`);

    if (!data) {
      return null;
    }

    const session = JSON.parse(data) as Session;

    // Check if session has expired (belt and suspenders with KV TTL)
    if (session.expiresAt < Date.now()) {
      // Clean up expired session
      await kv.delete(`${SESSION_PREFIX}${sessionId}`);
      return null;
    }

    return session;
  } catch (error) {
    console.error('Error retrieving session:', error);
    return null;
  }
}

/**
 * Deletes a session from Cloudflare KV
 * @param kv - Cloudflare KV namespace
 * @param sessionId - The session ID to delete
 */
export async function deleteSession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(`${SESSION_PREFIX}${sessionId}`);
}

/**
 * Gets the session ID from cookies
 * @param cookies - Astro cookies object
 * @returns The session ID or null
 */
export function getSessionIdFromCookie(cookies: AstroCookies): string | null {
  return cookies.get(SESSION_COOKIE_NAME)?.value || null;
}

/**
 * Sets the session cookie
 * @param cookies - Astro cookies object
 * @param sessionId - The session ID to set
 * @param maxAgeSeconds - Cookie max age in seconds
 */
export function setSessionCookie(
  cookies: AstroCookies,
  sessionId: string,
  maxAgeSeconds: number
): void {
  cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

/**
 * Clears the session cookie
 * @param cookies - Astro cookies object
 */
export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

/**
 * Extracts public session data (safe for client exposure)
 * @param session - Full session data
 * @returns Public session data
 */
export function toPublicSession(session: Session): PublicSession {
  return {
    userId: session.userId,
    login: session.login,
    displayName: session.displayName,
    profileImageUrl: session.profileImageUrl,
  };
}

/**
 * Helper to get session from KV using cookie
 * Combines cookie reading and KV lookup
 */
export async function getSession(
  kv: KVNamespace,
  cookies: AstroCookies
): Promise<Session | null> {
  const sessionId = getSessionIdFromCookie(cookies);
  return getSessionFromKV(kv, sessionId ?? undefined);
}
