import { Twitch } from 'arctic';

/**
 * Creates a Twitch OAuth client using Arctic
 */
export function createTwitchClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Twitch {
  return new Twitch(clientId, clientSecret, redirectUri);
}

/**
 * Twitch user profile data
 */
export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
  email?: string;
}

/**
 * Fetches the authenticated user's profile from Twitch API
 */
export async function getTwitchUser(
  accessToken: string,
  clientId: string
): Promise<TwitchUser> {
  const response = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Twitch user: ${response.status} ${error}`);
  }

  const data = await response.json();

  if (!data.data || data.data.length === 0) {
    throw new Error('No user data returned from Twitch API');
  }

  const user = data.data[0];

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    email: user.email,
  };
}

/**
 * Validates a Twitch access token
 * Returns true if valid, false if expired/invalid
 */
export async function validateTwitchToken(accessToken: string): Promise<boolean> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: {
      'Authorization': `OAuth ${accessToken}`,
    },
  });

  return response.ok;
}
