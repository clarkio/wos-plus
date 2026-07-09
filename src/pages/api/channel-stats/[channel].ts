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
      // when its Twitch username appears in the `users` table's
      // `twitch_usernames` list (issue #79).
      supabase
        .from('users')
        .select('twitch_usernames')
        .contains('twitch_usernames', [cleanChannel])
        .limit(1),
    ]);

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
