import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 100% in dev, lower in prod for performance
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: sample some sessions, all error sessions
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  integrations: [
    Sentry.replayIntegration(),
    // Sentry.feedbackIntegration({ colorScheme: "system" }),
  ],

  // Uncomment to reduce PII if needed
  // dataCollection: { userInfo: false, httpBodies: [] },
});

// Hook for App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
