/// <reference types="astro/client" />

declare namespace Cloudflare {
  interface Env {
    SUPABASE_URL: string;
    SUPABASE_KEY: string;
    CORS_ALLOWED_ORIGINS?: string;
    MIN_WORD_LENGTH?: string;
    MAX_WORD_LENGTH?: string;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
