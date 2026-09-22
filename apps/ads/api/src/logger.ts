import { randomUUID } from "node:crypto";
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "tharros-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function newRequestId(incoming?: string | null): string {
  return incoming && incoming.trim().length > 0 ? incoming : randomUUID();
}

export function childLogger(requestId: string) {
  return logger.child({ requestId });
}
