import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse } from '../../lib/api-utils';
import { createCorsPreflightResponse } from '../../lib/cors';
import { getSupabaseClient } from '../../lib/supabase';

export const prerender = false;
const ALLOWED_METHODS = ['GET', 'OPTIONS'] as const;

// Handle CORS preflight requests
export const OPTIONS: APIRoute = async ({ request }) => {
  return createCorsPreflightResponse(request, env, ALLOWED_METHODS);
};

export const GET: APIRoute = async ({ request }) => {
  try {
    const supabase = getSupabaseClient();

    // Fetch all words using pagination to avoid Supabase's row limit
    const allWords: string[] = [];
    const pageSize = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('words')
        .select('normalized_word')
        .range(from, from + pageSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allWords.push(...data.map((row: any) => row.normalized_word));
        from += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    return jsonResponse(allWords, request, ALLOWED_METHODS);
  } catch (error: any) {
    console.error('Error fetching words:', error);
    return jsonResponse({ error: error.message }, request, ALLOWED_METHODS, 500);
  }
};
