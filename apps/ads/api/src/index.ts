import { serve } from "@hono/node-server";
import { loadEnv } from "@tharros/ads-shared/env";
import { assertServiceWorkspaceConfigured } from "./auth";
import { createApp, VERSION } from "./app";
import { logger } from "./logger";

loadEnv();

try {
  assertServiceWorkspaceConfigured();
} catch (error) {
  logger.error({
    msg: "api.boot_refused",
    error: error instanceof Error ? error.message : "ADS_INTERNAL_WORKSPACE_ID is required",
  });
  process.exit(1);
}

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 43180);
const app = createApp();

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  logger.info({
    msg: "api.listen",
    version: VERSION,
    url: `http://${info.address}:${info.port}`,
  });
});
