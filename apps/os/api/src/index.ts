import { serve } from "@hono/node-server";
import { loadEnv } from "@tharros/shared";
import { createApp, VERSION } from "./app";
import { logger } from "./logger";

loadEnv();

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
