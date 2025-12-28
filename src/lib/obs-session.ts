/// <reference types="@cloudflare/workers-types" />

import type { Session } from './session';

export interface ObsSession {
  token: string;
  userId: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
  expiresAt: number; // epoch ms
  createdAt: number; // epoch ms
}

const OBS_SESSION_PREFIX = 'obsSession:';
const OBS_SESSION_BY_USER_PREFIX = 'obsSessionByUser:';

// Default: 30 days (covers 48h+ streams comfortably)
export const DEFAULT_OBS_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function buildStreamerObsUrl(origin: string, token: string): string {
  const url = new URL('/streamer', origin);
  url.searchParams.set('obs', token);
  return url.toString();
}

export async function getObsSessionFromKV(
  kv: KVNamespace,
  token: string | null | undefined
): Promise<ObsSession | null> {
  if (!token) {
    return null;
  }

  const raw = await kv.get(`${OBS_SESSION_PREFIX}${token}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ObsSession;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt < Date.now()) {
      // Best-effort cleanup
      await kv.delete(`${OBS_SESSION_PREFIX}${token}`);
      if (parsed.userId) {
        await kv.delete(`${OBS_SESSION_BY_USER_PREFIX}${parsed.userId}`);
      }
      return null;
    }
    return parsed;
  } catch {
    // Best-effort cleanup for corrupt entry
    await kv.delete(`${OBS_SESSION_PREFIX}${token}`);
    return null;
  }
}

export async function createOrReuseObsSession(
  kv: KVNamespace,
  userSession: Pick<Session, 'userId' | 'login' | 'displayName' | 'profileImageUrl'>,
  ttlSeconds: number = DEFAULT_OBS_SESSION_TTL_SECONDS,
  options?: { regenerate?: boolean }
): Promise<ObsSession> {
  const regenerate = options?.regenerate === true;

  if (regenerate) {
    const existingToken = await kv.get(`${OBS_SESSION_BY_USER_PREFIX}${userSession.userId}`);
    if (existingToken) {
      // Best-effort revocation of any previously issued URL.
      await kv.delete(`${OBS_SESSION_PREFIX}${existingToken}`);
      await kv.delete(`${OBS_SESSION_BY_USER_PREFIX}${userSession.userId}`);
    }
  }

  if (!regenerate) {
    const existingToken = await kv.get(`${OBS_SESSION_BY_USER_PREFIX}${userSession.userId}`);
    if (existingToken) {
      const existing = await getObsSessionFromKV(kv, existingToken);
      if (existing) {
        return existing;
      }
    }
  }

  const token = crypto.randomUUID();
  const now = Date.now();

  const obsSession: ObsSession = {
    token,
    userId: userSession.userId,
    login: userSession.login,
    displayName: userSession.displayName,
    profileImageUrl: userSession.profileImageUrl,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
  };

  // Store both: token -> session, and userId -> token (so the URL is stable for the user)
  const kvOptions = { expirationTtl: Math.max(ttlSeconds, 60) };
  await kv.put(`${OBS_SESSION_PREFIX}${token}`, JSON.stringify(obsSession), kvOptions);
  await kv.put(`${OBS_SESSION_BY_USER_PREFIX}${userSession.userId}`, token, kvOptions);

  return obsSession;
}

export function obsSessionToAppSession(obs: ObsSession): Session {
  // IMPORTANT: OBS sessions are intentionally display-only.
  // We do not embed Twitch access/refresh tokens in these long-lived sessions.
  return {
    userId: obs.userId,
    login: obs.login,
    displayName: obs.displayName,
    profileImageUrl: obs.profileImageUrl,
    accessToken: '',
    refreshToken: '',
    expiresAt: obs.expiresAt,
  };
}
