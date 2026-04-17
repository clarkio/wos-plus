// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

import sentry from "@sentry/astro";

// https://astro.build/config
export default defineConfig({
  site: "https://wosplus.com",
  adapter: cloudflare(),
  integrations: [
    sentry({
      project: "javascript-astro",
      org: "clarkio",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
