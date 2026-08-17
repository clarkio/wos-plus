import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidTwitchLoginFormat,
  normalizeTwitchLogin,
  twitchChannelExists,
  validateTwitchLogin,
} from '@scripts/twitch-channel';

describe('isValidTwitchLoginFormat', () => {
  it('accepts a typical login', () => {
    expect(isValidTwitchLoginFormat('clarkio')).toBe(true);
  });

  it('accepts logins with numbers and underscores', () => {
    expect(isValidTwitchLoginFormat('some_user_123')).toBe(true);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isValidTwitchLoginFormat('  clarkio  ')).toBe(true);
  });

  it('accepts the shortest non-empty login in the approved 1-50 rule', () => {
    expect(isValidTwitchLoginFormat('a')).toBe(true);
  });

  it('accepts a 50-character login and rejects a longer one', () => {
    expect(isValidTwitchLoginFormat('a'.repeat(50))).toBe(true);
    expect(isValidTwitchLoginFormat('a'.repeat(51))).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isValidTwitchLoginFormat('')).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidTwitchLoginFormat('clark.io')).toBe(false);
    expect(isValidTwitchLoginFormat('clark io')).toBe(false);
    expect(isValidTwitchLoginFormat('clark@io')).toBe(false);
    expect(isValidTwitchLoginFormat('#clarkio')).toBe(false);
    expect(isValidTwitchLoginFormat('twitch.tv/clarkio')).toBe(false);
  });
});

describe('validateTwitchLogin', () => {
  it('reports required for non-text and empty inputs', () => {
    expect(validateTwitchLogin(null)).toEqual({ error: 'required' });
    expect(validateTwitchLogin('')).toEqual({ error: 'required' });
    expect(validateTwitchLogin('#')).toEqual({ error: 'required' });
  });

  it('reports format for invalid characters without stripping an inner hash', () => {
    expect(validateTwitchLogin('bad channel')).toEqual({ error: 'format' });
    expect(validateTwitchLogin('clark#io')).toEqual({ error: 'format' });
  });

  it('reports length for a login over 50 characters', () => {
    expect(validateTwitchLogin('a'.repeat(51))).toEqual({ error: 'length' });
  });

  it('returns the normalized login for valid input', () => {
    expect(validateTwitchLogin('  #ClarkIO  ')).toEqual({ login: 'clarkio' });
  });
});

describe('normalizeTwitchLogin', () => {
  it('trims, strips a leading hash, and lowercases a login', () => {
    expect(normalizeTwitchLogin('  #ClarkIO  ')).toBe('clarkio');
  });

  it('accepts letters, digits, and underscores from 1 through 50 characters', () => {
    expect(normalizeTwitchLogin('a')).toBe('a');
    expect(normalizeTwitchLogin('some_user_123')).toBe('some_user_123');
    expect(normalizeTwitchLogin('a'.repeat(50))).toBe('a'.repeat(50));
  });

  it('rejects empty, overlong, malformed, and non-text values', () => {
    expect(normalizeTwitchLogin('')).toBeNull();
    expect(normalizeTwitchLogin('a'.repeat(51))).toBeNull();
    expect(normalizeTwitchLogin('bad channel')).toBeNull();
    expect(normalizeTwitchLogin('twitch.tv/clark.io')).toBeNull();
    expect(normalizeTwitchLogin(null)).toBeNull();
  });
});

describe('twitchChannelExists', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns true when Twitch reports a matching user', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { id: '123' } } }),
    });

    await expect(twitchChannelExists('clarkio')).resolves.toBe(true);
  });

  it('returns false when Twitch reports no matching user', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: null } }),
    });

    await expect(twitchChannelExists('nonexistentchannel')).resolves.toBe(
      false,
    );
  });

  it('returns null when the response is not ok', async () => {
    (global.fetch as any).mockResolvedValue({ ok: false });

    await expect(twitchChannelExists('clarkio')).resolves.toBeNull();
  });

  it('returns null when the response contains GraphQL errors', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: 'boom' }] }),
    });

    await expect(twitchChannelExists('clarkio')).resolves.toBeNull();
  });

  it('returns null when the fetch throws (network error/timeout)', async () => {
    (global.fetch as any).mockRejectedValue(new Error('network down'));

    await expect(twitchChannelExists('clarkio')).resolves.toBeNull();
  });

  it('resolves to null instead of hanging forever when the request never settles', async () => {
    (global.fetch as any).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            { reject(new DOMException('Aborted', 'AbortError')); },
          );
        }),
    );

    await expect(
      twitchChannelExists('clarkio', { timeoutMs: 20 }),
    ).resolves.toBeNull();
  });

  it('sends the login as a GraphQL variable, not interpolated into the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { id: '1' } } }),
    });
    global.fetch = fetchMock;

    await twitchChannelExists('clarkio');

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.variables).toEqual({ login: 'clarkio' });
    expect(body.query).not.toContain('clarkio');
  });
});
