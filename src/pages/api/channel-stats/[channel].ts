import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from 'cloudflare:workers';

export const prerender = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const GET: APIRoute = async ({ params }) => {
  const { channel } = params;

  if (!channel) {
    return new Response(JSON.stringify({ error: 'Channel name is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cleanChannel = channel.toLowerCase().trim();

  if (!/^[a-z0-9_]+$/.test(cleanChannel)) {
    return new Response(JSON.stringify({ error: 'Invalid channel name format. Only lowercase letters, numbers, and underscores are allowed.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (cleanChannel.length < 1 || cleanChannel.length > 50) {
    return new Response(JSON.stringify({ error: 'Invalid channel name length. Must be between 1 and 50 characters.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_KEY
    );

    const todayUtc = new Date().toISOString().slice(0, 10);

    // PostgREST reports a `.single()` query that matched zero rows as an error
    // with code `PGRST116` — that is "not found", not "the read failed", and
    // must keep answering 200 with a zero (see specs/channel-stats.md
    // § "a channel WoS+ has never seen"). Any other error code is a genuine
    // failure and must never be presented to the caller as a fabricated zero
    // (issue #173).
    const isGenuineReadFailure = (error: { code?: string } | null): boolean =>
      !!error && error.code !== 'PGRST116';

    const [allTimeResult, dailyResult, userResult] = await Promise.all([
      supabase
        .from('wos_channel_all_time_records')
        .select('all_time_highest_level_reached')
        .eq('channel', cleanChannel)
        .single(),
      supabase
        .from('wos_channel_daily_achievements')
        .select('highest_level_reached, board_clears')
        .eq('channel', cleanChannel)
        .eq('stat_date_utc', todayUtc)
        .single(),
      // The chatbot is the source of truth for daily stats and only writes them
      // for channels that have it enabled. A channel counts as chatbot-enabled
      // when its Twitch username appears in the `users` table (issue #79).
      // Twitch login names are canonically lowercase, matching the already
      // lowercased `cleanChannel`, so an equality match is sufficient.
      supabase
        .from('users')
        .select('twitch_username')
        .eq('twitch_username', cleanChannel)
        .limit(1),
    ]);

    if (allTimeResult.error) {
      console.error('Error fetching all-time channel record:', allTimeResult.error);
    }
    if (dailyResult.error) {
      console.error('Error fetching daily channel record:', dailyResult.error);
    }
    if (userResult.error) {
      console.error('Error fetching chatbot-enabled status:', userResult.error);
    }

    // Never turn a genuine read failure into a fabricated zero: a 200 with
    // three zeros is indistinguishable from a channel that has never played,
    // and a refresh may only ever raise the on-screen numbers, so a phantom
    // zero could never be corrected by a later real read (issue #173).
    if (isGenuineReadFailure(allTimeResult.error) || isGenuineReadFailure(dailyResult.error)) {
      return new Response(JSON.stringify({ error: 'Failed to read channel records' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allTimePersonalBest = allTimeResult.data?.all_time_highest_level_reached ?? 0;
    const dailyBest = dailyResult.data?.highest_level_reached ?? 0;
    const dailyClears = dailyResult.data?.board_clears ?? 0;
    // Fail closed: if the lookup errors we treat the channel as not enabled so
    // empty daily badges stay hidden rather than showing blank values.
    const chatbotEnabled =
      !userResult.error && Array.isArray(userResult.data) && userResult.data.length > 0;

    return new Response(JSON.stringify({
      allTimePersonalBest,
      dailyBest,
      dailyClears,
      chatbotEnabled,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching channel stats:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
