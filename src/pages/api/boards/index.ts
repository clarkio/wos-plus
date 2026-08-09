import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { findRedundantWords, isWellFormedSlot, normalizeLanguageCode, normalizeTwitchChannel, validateBoardName } from '../../../lib/board-utils';

export const prerender = false;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Handle CORS preflight requests (issue #172).
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: corsHeaders });

export const GET: APIRoute = async () => {
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
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      return new Response(
        JSON.stringify({
          error: nameValidation.error,
          message: `Board ${body.id} was not saved: ${nameValidation.error}.`,
          code: 'INVALID_BOARD_ID',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Guard (issue #119): reject boards whose slots contain the same word more
  // than once — that data is corrupted and would need manual cleanup later.
  const redundantWords = findRedundantWords(body?.slots);
  if (redundantWords.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Redundant words in board slots',
        message: `Board ${body?.id || 'ID'} contains redundant words: ${redundantWords.join(', ')}.`,
        code: 'REDUNDANT_WORDS',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
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
    return new Response(
      JSON.stringify({
        error: 'Unsupported or missing word language',
        message: `Board ${body?.id || 'ID'} was not saved: a supported word language (en, pt or fr) is required.`,
        code: 'INVALID_LANGUAGE',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
  body.language_code = cleanLanguageCode;

  // Guard (issue #162): the save path must apply the same slot-shape rule the
  // repair path already enforces (PUT /api/boards/[id]) — every slot needs a
  // `letters` array and a non-empty `word`. This is also what keeps an
  // incomplete capture (a slot whose word was never fully worked out) out of
  // the archive, since an unsolved slot is exactly a slot with no word.
  if (!Array.isArray(body?.slots) || body.slots.length === 0 || !body.slots.every(isWellFormedSlot)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid slot structure detected',
        message: `Board ${body?.id || 'ID'} was not saved: its slots are missing letters or a word.`,
        code: 'INVALID_SLOTS',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );
    const { data, error } = await supabase
      .from('boards')
      .insert(body)
      .select();

    if (error) {
      const isDuplicateBoard =
        error.code === '23505' ||
        /duplicate key value/i.test(error.message || '');

      if (isDuplicateBoard) {
        return new Response(
          JSON.stringify({
            error: 'Board already exists',
            message: `Board ${body?.id || 'ID'} has already been saved.`,
            code: 'BOARD_EXISTS',
          }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      throw error;
    }

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
