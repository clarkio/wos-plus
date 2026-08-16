import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';

/**
 * Creates a Supabase client from the Cloudflare Worker bindings.
 */
export const getSupabaseClient = () =>
  createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
