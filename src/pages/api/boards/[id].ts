import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
export const prerender = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const GET: APIRoute = async ({ params, locals }) => {
  const { env } = locals.runtime;
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: 'Board ID is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );
    
    // Query for the specific board by ID
    const { data, error } = await supabase
      .from('boards')
      .select('*')
      .eq('id', id.toUpperCase())
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return new Response(JSON.stringify({ error: 'Board not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching board:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
