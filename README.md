# wos-plus

This is a tool to assist with playing the game Words on Stream (WOS) and enhance the experience for all players.

A great summary of the tool and objective from [xScarletSagex](https://twitch.tv/xScarletSagex) on Twitch:
this just automates tricks we already use for higher levels and solved the biggest issue where we wish we knew what words we missed

## Setup

### Prerequisites

1. Node.js (v18 or higher)
2. A Twitch account
3. A Supabase account (for database)
4. A Twitch application for OAuth

### Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in the environment variables:

   **Supabase Configuration:**
   - Get your Supabase URL and anon key from your Supabase project settings

   **Twitch OAuth Configuration:**
   - Create a Twitch application at https://dev.twitch.tv/console/apps
   - Set the OAuth Redirect URL to: `https://your-domain.com/api/auth/callback`
   - Copy the Client ID and Client Secret

   **JWT Secret:**
   - Generate a secure random string (at least 32 characters)
   - You can use: `openssl rand -base64 32`

3. For Cloudflare Workers deployment, set these as secrets:
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   npx wrangler secret put TWITCH_CLIENT_ID
   npx wrangler secret put TWITCH_CLIENT_SECRET
   npx wrangler secret put TWITCH_REDIRECT_URI
   npx wrangler secret put JWT_SECRET
   ```

### Development

```bash
npm install
npm run dev
```

### Deployment

```bash
npm run build
npx wrangler deploy
```

## Features

- **Twitch Authentication**: Secure sign-in with your Twitch account
- **Player View**: Track words, personal bests, and game progress
- **Streamer View**: Enhanced layout optimized for streaming
- **Real-time Updates**: Live game state tracking
- **Twitch Chat Integration**: Connect to Twitch chat for coordination
