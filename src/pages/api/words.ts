import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders, createCorsPreflightResponse } from '../../lib/cors';
export const prerender = false;

// Handle CORS preflight requests
export const OPTIONS: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
  return createCorsPreflightResponse(request, env);
};

// export const POST: APIRoute = async ({ request, locals }) => {
//   const { env } = locals.runtime;
//   const corsHeaders = getCorsHeaders(request, env);

//   // Require authentication for write operations
//   if (!locals.session) {
//     return new Response(JSON.stringify({ error: 'Authentication required' }), {
//       status: 401,
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   }

//   // Parse JSON safely
//   let body: any;
//   try {
//     body = await request.json();
//   } catch (err: any) {
//     return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
//       status: 400,
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   }

//   // Basic validation / sanitization
//   if (!body || typeof body !== 'object') {
//     return new Response(JSON.stringify({ error: 'Request body must be a JSON object' }), {
//       status: 400,
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   }

//   // Allow either normalized_word or word fields as input
//   const rawWord = (body.normalized_word || body.word || body.normalizedWord || '') as string;
//   const trimmed = String(rawWord).trim();

//   const MIN_LEN = env.MIN_WORD_LENGTH || 4;
//   const MAX_LEN = env.MAX_WORD_LENGTH || 10;
//   const validRegex = /^[a-zA-Z]+$/;

//   if (!trimmed || trimmed.length < MIN_LEN || trimmed.length > MAX_LEN || !validRegex.test(trimmed)) {
//     return new Response(JSON.stringify({ error: `Invalid word. Must be ${MIN_LEN}-${MAX_LEN} letters (a-z)` }), {
//       status: 400,
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   }

//   const normalized = trimmed.toLowerCase();

//   try {
//     const supabase = createClient(
//       env.SUPABASE_URL,
//       env.SUPABASE_KEY
//     );

//     // Insert only the sanitized normalized_word to avoid unexpected fields
//     const { data, error } = await supabase
//       .from('words')
//       .insert({ normalized_word: normalized })
//       .select();

//     if (error) throw error;

//     return new Response(JSON.stringify(data), {
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   } catch (error: any) {
//     console.error('Error creating board:', error);
//     return new Response(JSON.stringify({ error: error.message }), {
//       status: 500,
//       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
//     });
//   }
// };

export const GET: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
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

