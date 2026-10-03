import * as Sentry from "@sentry/nextjs";
import { scrubSentryBreadcrumb, scrubSentryEvent } from "./lib/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 100% in dev, lower in prod for performance
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: sample some sessions, all error sessions
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  includeLocalVariables: false,
  sendDefaultPii: false,
  dataCollection: {
    cookies: false,
    urlQueryParams: false,
    userInfo: false,
  },

  enableLogs: true,

  integrations: [
    Sentry.replayIntegration(),
    // Sentry.feedbackIntegration({ colorScheme: "system" }),
  ],

  beforeSend(event) {
    return scrubSentryEvent(event);
  },
  beforeSendTransaction(event) {
    return scrubSentryEvent(event);
  },
  beforeBreadcrumb(breadcrumb) {
    return scrubSentryBreadcrumb(breadcrumb);
  },
});

// Hook for App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
