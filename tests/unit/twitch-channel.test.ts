import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidTwitchLoginFormat,
  twitchChannelExists,
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

  it('rejects logins shorter than 4 characters', () => {
    expect(isValidTwitchLoginFormat('abc')).toBe(false);
  });

  it('rejects logins longer than 25 characters', () => {
    expect(isValidTwitchLoginFormat('a'.repeat(26))).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isValidTwitchLoginFormat('')).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidTwitchLoginFormat('clark.io')).toBe(false);
    expect(isValidTwitchLoginFormat('clark io')).toBe(false);
    expect(isValidTwitchLoginFormat('clark@io')).toBe(false);
    expect(isValidTwitchLoginFormat('twitch.tv/clarkio')).toBe(false);
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
            reject(new DOMException('Aborted', 'AbortError')),
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
