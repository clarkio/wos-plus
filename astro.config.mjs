// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

import sentry from "@sentry/astro";

// https://astro.build/config
export default defineConfig({
  site: "https://wosplus.com",
  // Astro 7 changed the default to "jsx", which strips whitespace between
  // inline elements (e.g. the space before links in running text).
  compressHTML: true,
  adapter: cloudflare({
    imageService: "compile",
    prerenderEnvironment: "node",
  }),
  integrations: [
    sentry({
      project: "javascript-astro",
      org: "clarkio",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourceMapsUploadOptions: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
    }),
  ],
});
