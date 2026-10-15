import { serve } from "@hono/node-server";
import { createApp, SERVICE_NAME } from "./app";
import { createHttpGuardClient } from "./guards";
import { assertMcpRuntimeConfigured, listenPort } from "./runtime";

try {
  assertMcpRuntimeConfigured(process.env);
} catch (error) {
  const message = error instanceof Error ? error.message : "mcp runtime is not configured";
  console.error(JSON.stringify({ msg: "mcp.boot_refused", error: message }));
  process.exit(1);
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = listenPort(process.env.PORT);
if (!Number.isInteger(port)) {
  console.error(JSON.stringify({ msg: "mcp.bad_port" }));
  process.exit(1);
}

const app = createApp({
  allowedOrigins: process.env.MCP_ALLOWED_ORIGINS ?? "",
  killSwitchEnv: process.env.MCP_CONNECTOR_KILL_SWITCH,
  guards: createHttpGuardClient({
    apiUrl: process.env.ADS_API_URL,
    internalKey: process.env.ADS_INTERNAL_KEY,
  }),
});

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(JSON.stringify({ msg: "mcp.listen", service: SERVICE_NAME, host: info.address, port: info.port }));
});
