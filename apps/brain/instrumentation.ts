import * as Sentry from "@sentry/nextjs";
import { assertEncryptionConfigured } from "./src/lib/encryption";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertEncryptionConfigured();
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors (Server Components, etc.)
// Requires @sentry/nextjs >= 8.28.0
export const onRequestError = Sentry.captureRequestError;
