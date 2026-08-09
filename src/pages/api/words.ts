import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders, createCorsPreflightResponse } from '../../lib/cors';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Handle CORS preflight requests
export const OPTIONS: APIRoute = async ({ request }) => {
  return createCorsPreflightResponse(request, env);
};

export const GET: APIRoute = async ({ request }) => {
  const corsHeaders = getCorsHeaders(request, env);
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

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

    return new Response(JSON.stringify(allWords), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching words:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
