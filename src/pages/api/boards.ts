import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders, createCorsPreflightResponse } from '../../lib/cors';
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
  const body = await request.json();

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
