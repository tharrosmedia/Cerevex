import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestNodeServe } from "inngest/node";
import pino from "pino";
import { loadEnv } from "@tharros/ads-shared/env";
import { assertAdsWorkerProductionSecrets } from "@tharros/ads-shared/production-secrets";
import { checkDatabase } from "@tharros/ads-shared/db";
import { checkInngest, inngest } from "@tharros/ads-shared/inngest";
import { warnIfMetaNotConfigured, workerHealthBody } from "@tharros/ads-shared/worker-health";
import { FUNCTION_IDS, functions } from "./register";

loadEnv();

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "tharros-worker" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

try {
  assertAdsWorkerProductionSecrets();
} catch (error) {
  logger.error({ msg: error instanceof Error ? error.message : "Required production secrets are missing" });
  process.exit(1);
}

const app = new Hono();
app.get("/health", async (c) => {
  const [dbOk, inngestStatus] = await Promise.all([
    checkDatabase().catch(() => false),
    checkInngest(),
  ]);
  const body = workerHealthBody({
    dbOk: Boolean(dbOk),
    inngestStatus,
    functionIds: FUNCTION_IDS,
  });
  return c.json(body, body.ok ? 200 : 503);
});

const inngestHandler = inngestNodeServe({
  client: inngest,
  functions,
});

const honoListener = getRequestListener(app.fetch);
warnIfMetaNotConfigured((message) => {
  logger.warn({ msg: message });
});

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.WORKER_PORT ?? 43182);

createServer((req, res) => {
  const path = (req.url ?? "").split("?", 1)[0];
  if (path === "/api/inngest") {
    void inngestHandler(req, res);
    return;
  }
  void honoListener(req, res);
}).listen(port, host, () => {
  logger.info({
    msg: "worker.listen",
    url: `http://${host}:${port}`,
    inngest: `http://${host}:${port}/api/inngest`,
    functions: FUNCTION_IDS,
  });
});
