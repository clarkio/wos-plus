import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse } from '../../../lib/api-utils';
import { findRedundantWords, isWellFormedSlot, normalizeLanguageCode, normalizeTwitchChannel, validateBoardName } from '../../../lib/board-utils';
import { createCorsPreflightResponse } from '../../../lib/cors';
import { getSupabaseClient } from '../../../lib/supabase';

export const prerender = false;
const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'] as const;

// Handle CORS preflight requests (issue #172).
export const OPTIONS: APIRoute = ({ request }) =>
  createCorsPreflightResponse(request, env, ALLOWED_METHODS);

export const GET: APIRoute = async ({ request }) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('boards')
      .select('*');
    if (error) throw error;

    return jsonResponse(data, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
    });
  } catch (error: any) {
    console.error('Error fetching boards:', error);
    return jsonResponse({ error: error.message }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 500,
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  // An unreadable body must be answered, not thrown: an uncaught parse error
  // escapes the handler and becomes an Astro error page with no CORS headers,
  // which a browser caller can only see as an opaque network failure. The
  // sibling PUT in ./[id].ts already answers this case the same way.
  // Declared without an annotation so it keeps the same inferred type the
  // original `const body = await request.json()` had.
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 400,
    });
  }

  // Guard (issue #162): the save path must apply the same board-name rule
  // lookup and repair already enforce (specs/boards.md § Naming a board).
  // Only checked when a name was actually offered — a completely nameless
  // capture is a different failure (the archive's own not-null constraint,
  // or another guard below), not a bad name.
  if (body?.id !== undefined) {
    const nameValidation = validateBoardName(body.id);
    if ('error' in nameValidation) {
      return jsonResponse({
        error: nameValidation.error,
        message: `Board ${body.id} was not saved: ${nameValidation.error}.`,
        code: 'INVALID_BOARD_ID',
      }, {
        request,
        env,
        allowedMethods: ALLOWED_METHODS,
        status: 400,
      });
    }
  }

  // Guard (issue #119): reject boards whose slots contain the same word more
  // than once — that data is corrupted and would need manual cleanup later.
  const redundantWords = findRedundantWords(body?.slots);
  if (redundantWords.length > 0) {
    return jsonResponse({
      error: 'Redundant words in board slots',
      message: `Board ${body?.id || 'ID'} contains redundant words: ${redundantWords.join(', ')}.`,
      code: 'REDUNDANT_WORDS',
    }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 400,
    });
  }

  // The twitch channel is informational metadata: store the normalized value
  // when it's a valid channel name, otherwise drop it rather than failing the
  // save.
  if ('twitch_channel' in (body ?? {})) {
    const cleanTwitchChannel = normalizeTwitchChannel(body.twitch_channel);
    if (cleanTwitchChannel) {
      body.twitch_channel = cleanTwitchChannel;
    } else {
      delete body.twitch_channel;
    }
  }

  // Unlike the channel, the word language is not informational (issue #161):
  // a board's words only mean anything alongside the language they were
  // played in, so a missing or unrecognised language rejects the save
  // outright rather than silently substituting English.
  const cleanLanguageCode = normalizeLanguageCode(body?.language_code);
  if (!cleanLanguageCode) {
    return jsonResponse({
      error: 'Unsupported or missing word language',
      message: `Board ${body?.id || 'ID'} was not saved: a supported word language (en, pt or fr) is required.`,
      code: 'INVALID_LANGUAGE',
    }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 400,
    });
  }
  body.language_code = cleanLanguageCode;

  // Guard (issue #162): the save path must apply the same slot-shape rule the
  // repair path already enforces (PUT /api/boards/[id]) — every slot needs a
  // `letters` array and a non-empty `word`. This is also what keeps an
  // incomplete capture (a slot whose word was never fully worked out) out of
  // the archive, since an unsolved slot is exactly a slot with no word.
  if (!Array.isArray(body?.slots) || body.slots.length === 0 || !body.slots.every(isWellFormedSlot)) {
    return jsonResponse({
      error: 'Invalid slot structure detected',
      message: `Board ${body?.id || 'ID'} was not saved: its slots are missing letters or a word.`,
      code: 'INVALID_SLOTS',
    }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 400,
    });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('boards')
      .insert(body)
      .select();

    if (error) {
      const isDuplicateBoard =
        error.code === '23505' ||
        /duplicate key value/i.test(error.message || '');

      if (isDuplicateBoard) {
        return jsonResponse({
          error: 'Board already exists',
          message: `Board ${body?.id || 'ID'} has already been saved.`,
          code: 'BOARD_EXISTS',
        }, {
          request,
          env,
          allowedMethods: ALLOWED_METHODS,
          status: 409,
        });
      }

      throw error;
    }

    return jsonResponse(data, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
    });
  } catch (error: any) {
    console.error('Error creating board:', error);
    return jsonResponse({ error: error.message }, {
      request,
      env,
      allowedMethods: ALLOWED_METHODS,
      status: 500,
    });
  }
};
