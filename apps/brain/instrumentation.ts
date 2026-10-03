import * as Sentry from "@sentry/nextjs";

function shouldCheckProductionSecrets(): boolean {
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (process.env.npm_lifecycle_event === "build") return false;
  return true;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (shouldCheckProductionSecrets()) {
      const { assertProductionSecrets } = await import("./lib/prod-secrets");
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
