import { defineConfig, devices } from '@playwright/test';

/**
 * Thin E2E smoke layer (AGENTIC-TESTING-PLAN.md Phase 6 / issue #152).
 *
 * Deliberately narrow: it exercises the real Cloudflare Workers runtime via
 * `wrangler dev` against a production build, which unit and acceptance tests
 * structurally cannot — `prerender = false` / `locals.runtime.env`
 * misconfigurations only show up here. Everything WoS/Twitch-live-service
 * shaped stays out of scope; the worker/fixture tests already cover that
 * protocol handling deterministically.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // 127.0.0.1, not localhost: wrangler dev only binds IPv4, and some
    // sandboxes resolve "localhost" to ::1 first, which then hangs.
    baseURL: 'http://127.0.0.1:8788',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This repo pins its own @playwright/test version rather than
        // whatever revision `npx playwright install` would fetch, so point
        // at a preinstalled Chromium (set by CI / the sandbox) instead of
        // downloading one when available; otherwise fall back to Playwright's
        // own managed browser.
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
          // Required when Chromium runs as root (this repo's sandbox), which
          // refuses to start its own sandbox as root; a no-op for a normal
          // non-root CI runner user.
          args: process.env.PLAYWRIGHT_CHROMIUM_PATH ? ['--no-sandbox'] : [],
        },
      },
    },
  ],

  webServer: {
    command: 'pnpm run build && pnpm exec wrangler dev --port 8788 --ip 127.0.0.1 --show-interactive-dev-session=false',
    url: 'http://127.0.0.1:8788/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
