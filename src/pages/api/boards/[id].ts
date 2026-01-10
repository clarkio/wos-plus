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

  // Security validation: sanitize and validate board ID
  // Board IDs should only contain letters (they are words from the game)
  const cleanId = id.replace(/\s+/g, '').toUpperCase();
  
  // Validate: only alphabetic characters allowed
  if (!/^[A-Z]+$/.test(cleanId)) {
    return new Response(JSON.stringify({ error: 'Invalid board ID format. Only letters are allowed.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Validate: reasonable length (game words are typically 4-20 characters)
  if (cleanId.length < 4 || cleanId.length > 20) {
    return new Response(JSON.stringify({ error: 'Invalid board ID length. Must be between 4 and 20 characters.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );
    
    // Query for the specific board by ID using the sanitized cleanId
    const { data, error } = await supabase
      .from('boards')
      .select('*')
      .eq('id', cleanId)
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
