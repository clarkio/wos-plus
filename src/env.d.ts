/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  MIN_WORD_LENGTH: number;
  MAX_WORD_LENGTH: number;
  // CORS configuration
  CORS_ALLOWED_ORIGINS?: string;
  // Twitch OAuth
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  TWITCH_REDIRECT_URI: string;
  // Cloudflare KV for sessions
  WOS_SESSIONS: KVNamespace;
}

type CloudflareRuntime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals {
    runtime: CloudflareRuntime['runtime'];
    session?: import('./lib/session').Session;
  }
}




