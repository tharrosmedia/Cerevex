import { serve } from "@hono/node-server";
import { loadEnv } from "@tharros/ads-shared/env";
import { assertJwtSecretConfigured, warnIfJwtSecretUnset } from "./jwt-secret";
import { createApp, VERSION } from "./app";
import { logger } from "./logger";

loadEnv();
try {
  assertJwtSecretConfigured();
} catch (error) {
  logger.error({ msg: error instanceof Error ? error.message : "JWT_SECRET is required in production" });
  process.exit(1);
}
warnIfJwtSecretUnset((message) => logger.warn({ msg: message }));

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
