import type { Platform } from "./types";

export type MutationOutcome = {
  action: string;
  platform: Platform;
  target: { entityType: string; externalId: string; name?: string };
  status: "applied" | "skipped" | "already_applied" | "failed";
  mode: "mock" | "live";
  reason?: string;
  writes: boolean;
};

export type LiveEntityState = {
  externalId: string;
  entityType: string;
  status: string;
  dailyBudget?: number | null;
  bidAmount?: number | null;
};

export function percentOf(current: number | null | undefined, payload: Record<string, unknown>): number | null {
  const absolute = typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  if (Number.isFinite(absolute) && absolute > 0) return absolute;
  const percent = typeof payload.percent === "number" ? payload.percent : Number(payload.percent);
  if (!Number.isFinite(percent) || current == null || current <= 0) return null;
  return Math.max(0, current * (1 + percent / 100));
}
