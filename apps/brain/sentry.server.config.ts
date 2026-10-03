import * as Sentry from "@sentry/nextjs";
import { sentryScrubHooks } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // 100% in dev, lower in prod
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  includeLocalVariables: false,
  sendDefaultPii: false,
  dataCollection: {
    cookies: false,
    urlQueryParams: false,
    userInfo: false,
  },

  enableLogs: true,

  ...sentryScrubHooks(),
});
