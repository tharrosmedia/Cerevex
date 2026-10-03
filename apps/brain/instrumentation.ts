import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionSecrets, shouldCheckProductionSecrets } = await import("./lib/prod-secrets");
    // `npm run start` sets npm_lifecycle_event=start, so the check runs. `next build` skips it.
    if (shouldCheckProductionSecrets()) {
      try {
        assertProductionSecrets();
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
    }
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors (Server Components, etc.)
// Requires @sentry/nextjs >= 8.28.0
export const onRequestError = Sentry.captureRequestError;
