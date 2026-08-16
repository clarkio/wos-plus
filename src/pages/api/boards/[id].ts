import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { findRedundantWords, hasInvalidWords, hasRedundantWords, isWellFormedSlot, normalizeLanguageCode, normalizeTwitchChannel, validateBoardName } from '../../../lib/board-utils';
import { createCorsPreflightResponse, getCorsHeaders } from '../../../lib/cors';

export const prerender = false;

const ALLOWED_METHODS = ['GET', 'PUT', 'OPTIONS'] as const;

const jsonResponse = (request: Request, body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, env, ALLOWED_METHODS),
      'Content-Type': 'application/json',
    },
  });

// Security validation: sanitize and validate board ID.
// Board IDs should only contain letters (they are words from the game).
// Returns the cleaned ID, or an error response when validation fails.
// The rules themselves live in `validateBoardName` (src/lib/board-utils.ts),
// shared with the POST save path (issue #162); this just shapes the result
// into the Response this route's callers expect.
function validateBoardId(id: string | undefined, request: Request): { cleanId: string } | { errorResponse: Response } {
  const result = validateBoardName(id);
  if ('error' in result) {
    return { errorResponse: jsonResponse(request, { error: result.error }, 400) };
  }
  return result;
}

// Handle CORS preflight requests (issue #172).
export const OPTIONS: APIRoute = ({ request }) =>
  createCorsPreflightResponse(request, env, ALLOWED_METHODS);

export const GET: APIRoute = async ({ params, request }) => {
  const corsHeaders = getCorsHeaders(request, env, ALLOWED_METHODS);
  const validation = validateBoardId(params.id, request);
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

// Self-healing update for boards saved badly: the same word in multiple slots
// (issue #119), or a word using a letter that is not in the board's big word
// (issue #163 — the board id itself, since a board is filed under its big
// word). Only replaces the stored slots when the stored board is actually
// broken by one of those rules AND the incoming slots are clean, so a healthy
// board can never be overwritten through this endpoint.
export const PUT: APIRoute = async ({ params, request }) => {
  const validation = validateBoardId(params.id, request);
  if ('errorResponse' in validation) {
    return validation.errorResponse;
  }
  const { cleanId } = validation;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Invalid JSON body' }, 400);
  }

  const slots = body?.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    return jsonResponse(request, { error: 'slots must be a non-empty array' }, 400);
  }

  if (!slots.every(isWellFormedSlot)) {
    return jsonResponse(request, { error: 'Invalid slot structure detected' }, 400);
  }

  const redundantWords = findRedundantWords(slots);
  if (redundantWords.length > 0) {
    return jsonResponse(request, {
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
        return jsonResponse(request, { error: 'Board not found' }, 404);
      }
      throw fetchError;
    }

    const isStoredBoardSound =
      !hasRedundantWords(existingBoard?.slots) && !hasInvalidWords(existingBoard?.slots, cleanId);
    if (isStoredBoardSound) {
      return jsonResponse(request, {
        error: 'Board update not allowed',
        message: `Board ${cleanId} is already sound; refusing to overwrite it.`,
        code: 'BOARD_UPDATE_NOT_ALLOWED',
      }, 409);
    }

    // Also record (or back-fill) the channel the clean capture came from when
    // a valid one is provided; invalid values are dropped, not rejected.
    // updated_at is intentionally absent from the payload: a database trigger
    // (db-scripts/add-updated-at-to-boards.sql) stamps it on every UPDATE so
    // it always reflects server time regardless of how the row was changed.
    // The board's word language (issue #124) is treated the same way: a valid
    // code is recorded (or back-filled) with the clean capture, an invalid or
    // missing one leaves the stored value untouched.
    const cleanTwitchChannel = normalizeTwitchChannel(body?.twitch_channel);
    const cleanLanguageCode = normalizeLanguageCode(body?.language_code);
    const updatePayload: Record<string, unknown> = { slots };
    if (cleanTwitchChannel) {
      updatePayload.twitch_channel = cleanTwitchChannel;
    }
    if (cleanLanguageCode) {
      updatePayload.language_code = cleanLanguageCode;
    }

    const { data, error } = await supabase
      .from('boards')
      .update(updatePayload)
      .eq('id', cleanId)
      .select();

    if (error) throw error;

    return jsonResponse(request, data ?? []);
  } catch (error: any) {
    console.error('Error updating board:', error);
    return jsonResponse(request, { error: error.message }, 500);
  }
};
