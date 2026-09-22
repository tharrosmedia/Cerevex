import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestNodeServe } from "inngest/node";
import pino from "pino";
import { loadEnv } from "@tharros/ads-shared/env";
import { checkDatabase } from "@tharros/ads-shared/db";
import { checkInngest, inngest } from "@tharros/ads-shared/inngest";
import { functions as googleAdsFunctions, FUNCTION_IDS as GOOGLE_ADS_IDS } from "@shopify-brain/jobs-google-ads";
import { functions as metaAdsFunctions, FUNCTION_IDS as META_ADS_IDS } from "@shopify-brain/jobs-meta-ads";
import { OS_FUNCTION_IDS, osFunctions } from "./functions";

loadEnv();

const functions = [...osFunctions, ...metaAdsFunctions, ...googleAdsFunctions];
const FUNCTION_IDS = [...OS_FUNCTION_IDS, ...META_ADS_IDS, ...GOOGLE_ADS_IDS];

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

const app = new Hono();
app.get("/health", async (c) => {
  const [dbOk, inngestStatus] = await Promise.all([
    checkDatabase().catch(() => false),
    checkInngest(),
  ]);
  const ok = Boolean(dbOk);
  return c.json(
    {
      ok,
      service: "tharros-worker",
      version: "0.1.0",
      time: new Date().toISOString(),
      checks: {
        db: dbOk ? "ok" : "down",
        inngest: inngestStatus,
        functions: FUNCTION_IDS,
      },
    },
    ok ? 200 : 503,
  );
});

const inngestHandler = inngestNodeServe({
  client: inngest,
  functions,
});

const honoListener = getRequestListener(app.fetch);
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
