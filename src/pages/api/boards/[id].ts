import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { findRedundantWords, hasRedundantWords } from '../../../lib/board-utils';

export const prerender = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const jsonResponse = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Security validation: sanitize and validate board ID.
// Board IDs should only contain letters (they are words from the game).
// Returns the cleaned ID, or an error response when validation fails.
function validateBoardId(id: string | undefined): { cleanId: string } | { errorResponse: Response } {
  if (!id) {
    return { errorResponse: jsonResponse({ error: 'Board ID is required' }, 400) };
  }

  const cleanId = id.replace(/\s+/g, '').toUpperCase();

  // Validate: only alphabetic characters allowed
  if (!/^[A-Z]+$/.test(cleanId)) {
    return { errorResponse: jsonResponse({ error: 'Invalid board ID format. Only letters are allowed.' }, 400) };
  }

  // Validate: reasonable length (game words are typically 4-20 characters)
  if (cleanId.length < 4 || cleanId.length > 20) {
    return { errorResponse: jsonResponse({ error: 'Invalid board ID length. Must be between 4 and 20 characters.' }, 400) };
  }

  return { cleanId };
}

export const GET: APIRoute = async ({ params }) => {
  const validation = validateBoardId(params.id);
  if ('errorResponse' in validation) {
    return validation.errorResponse;
  }
  const { cleanId } = validation;

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

// Self-healing update for boards saved with redundant words (issue #119).
// Only replaces the stored slots when the stored board actually contains the
// same word in multiple slots AND the incoming slots are clean, so a healthy
// board can never be overwritten through this endpoint.
export const PUT: APIRoute = async ({ params, request }) => {
  const validation = validateBoardId(params.id);
  if ('errorResponse' in validation) {
    return validation.errorResponse;
  }
  const { cleanId } = validation;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const slots = body?.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    return jsonResponse({ error: 'slots must be a non-empty array' }, 400);
  }

  const isValidSlots = slots.every(slot =>
    slot &&
    typeof slot === 'object' &&
    Array.isArray(slot.letters) &&
    typeof slot.word === 'string' &&
    slot.word.length > 0
  );
  if (!isValidSlots) {
    return jsonResponse({ error: 'Invalid slot structure detected' }, 400);
  }

  const redundantWords = findRedundantWords(slots);
  if (redundantWords.length > 0) {
    return jsonResponse({
      error: 'Redundant words in board slots',
      message: `Board ${cleanId} update contains redundant words: ${redundantWords.join(', ')}.`,
      code: 'REDUNDANT_WORDS',
    }, 400);
  }

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );

    const { data: existingBoard, error: fetchError } = await supabase
      .from('boards')
      .select('*')
      .eq('id', cleanId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return jsonResponse({ error: 'Board not found' }, 404);
      }
      throw fetchError;
    }

    if (!hasRedundantWords(existingBoard?.slots)) {
      return jsonResponse({
        error: 'Board update not allowed',
        message: `Board ${cleanId} has no redundant words; refusing to overwrite it.`,
        code: 'BOARD_UPDATE_NOT_ALLOWED',
      }, 409);
    }

    const { data, error } = await supabase
      .from('boards')
      .update({ slots })
      .eq('id', cleanId)
      .select();

    if (error) throw error;

    return jsonResponse(data ?? []);
  } catch (error: any) {
    console.error('Error updating board:', error);
    return jsonResponse({ error: error.message }, 500);
  }
};
