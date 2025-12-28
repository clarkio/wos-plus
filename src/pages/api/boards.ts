import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders, createCorsPreflightResponse } from '../../lib/cors';
import { validateBoardInput, sanitizeBoardInput, type BoardInput } from '../../lib/validation';
export const prerender = false;

// Handle CORS preflight requests
export const OPTIONS: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
  return createCorsPreflightResponse(request, env);
};

export const GET: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
  const corsHeaders = getCorsHeaders(request, env);

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );
    const { data, error } = await supabase
      .from('boards')
      .select('*');
    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching boards:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const { env } = locals.runtime;
  const corsHeaders = getCorsHeaders(request, env);

  // Require authentication for write operations
  if (!locals.session) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate request body structure
  const validation = validateBoardInput(rawBody);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Sanitize input after validation
  const body = sanitizeBoardInput(rawBody as BoardInput);

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );
    const { data, error } = await supabase
      .from('boards')
      .insert(body)
      .select();

    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error creating board:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
