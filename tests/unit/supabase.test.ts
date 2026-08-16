import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';

const mocks = vi.hoisted(() => ({
  client: { marker: 'shared-client-factory-result' },
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

import { getSupabaseClient } from '../../src/lib/supabase';

const mutableEnv = env as unknown as Record<string, string>;
const originalUrl = mutableEnv.SUPABASE_URL;
const originalKey = mutableEnv.SUPABASE_KEY;

describe('getSupabaseClient', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue(mocks.client);
  });

  afterEach(() => {
    mutableEnv.SUPABASE_URL = originalUrl;
    mutableEnv.SUPABASE_KEY = originalKey;
  });

  it('creates a client from the Cloudflare Supabase bindings', () => {
    mutableEnv.SUPABASE_URL = 'https://configured.supabase.test';
    mutableEnv.SUPABASE_KEY = 'configured-key';

    const client = getSupabaseClient();

    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://configured.supabase.test',
      'configured-key',
    );
    expect(client).toBe(mocks.client);
  });
});
