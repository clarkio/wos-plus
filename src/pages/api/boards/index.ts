import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';
import { findRedundantWords, normalizeTwitchChannel } from '../../../lib/board-utils';

export const prerender = false;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

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
  const body = await request.json();

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
