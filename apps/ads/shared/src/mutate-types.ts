import type { Platform } from "./types";

/** Platform-native snapshot. Amounts are strings in that platform's own units. */
export type OutcomeValue = {
  status?: string;
  amount?: string;
  /** "minor" (Meta), "micros" (Google), "status" (pause), or "mock". */
  unit: string;
  currency?: string;
  /** UTC ISO timestamp. */
  readAt: string;
};

export const OUTCOME_UNIT = {
  minor: "minor",
  micros: "micros",
  status: "status",
  mock: "mock",
} as const;

export const META_MINOR_SCALE = 100;
export const GOOGLE_MICROS_SCALE = 1_000_000;

export type MutationOutcome = {
  action: string;
  platform: Platform;
  target: { entityType: string; externalId: string; name?: string };
  status: "applied" | "skipped" | "already_applied" | "failed";
  mode: "mock" | "live";
  reason?: string;
  writes: boolean | "unknown";
  before?: OutcomeValue;
  after?: OutcomeValue;
  revertible?: boolean;
  revertBlock?: "no_before_value";
};

export type LiveEntityState = {
  externalId: string;
  entityType: string;
  status: string;
  dailyBudget?: number | null;
  bidAmount?: number | null;
  /** Meta ad account id from the live re-check, without the act_ prefix. */
  accountId?: string | null;
  /** Exact platform amount from the live read. Meta minor units or Google micros. */
  budgetNative?: string | null;
  bidNative?: string | null;
  currency?: string | null;
  /** UTC ISO time of this live read. */
  readAt?: string;
};

export function utcNow(now = new Date()): string {
  return now.toISOString();
}

/** Keep a platform amount string. Numbers are truncated to the integer unit the APIs return. */
export function platformNativeAmount(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

export function nativeOrScaled(
  native: string | null | undefined,
  major: number | null | undefined,
  scale: number,
): string | null {
  if (native != null && native !== "") return native;
  if (major == null || !Number.isFinite(major)) return null;
  return String(Math.round(major * scale));
}

export function outcomeValue(input: {
  status?: string | null;
  amount?: string | null;
  unit: string;
  currency?: string | null;
  readAt?: string;
}): OutcomeValue {
  const value: OutcomeValue = {
    unit: input.unit,
    readAt: input.readAt ?? utcNow(),
  };
  if (input.status) value.status = input.status;
  if (input.amount != null && input.amount !== "") value.amount = input.amount;
  if (input.currency?.trim()) value.currency = input.currency.trim();
  return value;
}

export function stampNoBefore<T extends MutationOutcome>(outcome: T): T {
  return { ...outcome, revertible: false, revertBlock: "no_before_value" };
}

export function statusSnapshots(input: {
  beforeStatus: string;
  afterStatus: string;
  currency?: string | null;
  readAt?: string;
  alreadyApplied?: boolean;
}): { before: OutcomeValue; after: OutcomeValue; revertible: true } {
  if (input.alreadyApplied) {
    const paused = outcomeValue({
      status: "paused",
      unit: OUTCOME_UNIT.status,
      currency: input.currency,
      readAt: input.readAt,
    });
    return { before: paused, after: paused, revertible: true };
  }
  return {
    before: outcomeValue({
      status: input.beforeStatus,
      unit: OUTCOME_UNIT.status,
      currency: input.currency,
      readAt: input.readAt,
    }),
    after: outcomeValue({
      status: input.afterStatus,
      unit: OUTCOME_UNIT.status,
      currency: input.currency,
    }),
    revertible: true,
  };
}

export function amountSnapshots(input: {
  beforeAmount: string | null;
  afterAmount: string;
  unit: string;
  currency?: string | null;
  readAt?: string;
}): Pick<MutationOutcome, "before" | "after" | "revertible" | "revertBlock"> {
  const after = outcomeValue({
    amount: input.afterAmount,
    unit: input.unit,
    currency: input.currency,
  });
  if (!input.beforeAmount) {
    return { after, revertible: false, revertBlock: "no_before_value" };
  }
  return {
    before: outcomeValue({
      amount: input.beforeAmount,
      unit: input.unit,
      currency: input.currency,
      readAt: input.readAt,
    }),
    after,
    revertible: true,
  };
}

export function percentOf(current: number | null | undefined, payload: Record<string, unknown>): number | null {
  const absolute = typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  if (Number.isFinite(absolute) && absolute > 0) return absolute;
  const percent = typeof payload.percent === "number" ? payload.percent : Number(payload.percent);
  if (!Number.isFinite(percent) || current == null || current <= 0) return null;
  return Math.max(0, current * (1 + percent / 100));
}
