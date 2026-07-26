/**
 * Test stub for Cloudflare's `cloudflare:workers` virtual module.
 *
 * The API routes import `env` from this specifier, which only exists inside
 * the Workers runtime. Vitest cannot resolve it, so the affected routes were
 * transformed to raw TypeScript, failed to parse during coverage remapping,
 * and were silently dropped from the coverage report entirely.
 *
 * Aliased in `vitest.config.ts` for tests only — the production build still
 * resolves the real module.
 *
 * Values are mutable so a test can set credentials before invoking a handler.
 */
export const env: Record<string, string> = {
  SUPABASE_URL: 'https://stub.supabase.invalid',
  SUPABASE_KEY: 'stub-key-not-a-real-credential',
};
