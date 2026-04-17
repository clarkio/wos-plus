import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: "https://f1beb3144b0e5e4729eea8a19e6fcbba@o4511236000186368.ingest.us.sentry.io/4511236008837120",
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
