/// <reference types="astro/client" />

import type { SessionUser } from './lib/auth';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  TWITCH_REDIRECT_URI: string;
  JWT_SECRET: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: SessionUser;
  }
}
