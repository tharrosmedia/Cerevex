/**
 * Abort a platform write before the apply lease expires.
 * APPLYING_LEASE_MS is 120s. This stays well under that so a hung write cannot outlive the claim.
 */
export const PLATFORM_WRITE_TIMEOUT_MS = 30_000;

/** Whole executePrepared loop. Under the 120s lease, above one platform write. */
export const APPLY_EXECUTE_DEADLINE_MS = 90_000;

/** Leave the lease before the last call is allowed to start. */
export const APPLY_CALL_MARGIN_MS = 1_000;

/** Thrown before a platform call when the job budget is already gone. The call was not sent. */
export class ApplyCallBudgetError extends Error {
  constructor() {
    super("apply_deadline");
    this.name = "ApplyCallBudgetError";
  }
}

/** Time a single platform call may still run. Zero means do not start it. */
export function platformCallBudgetMs(deadlineAt: number, now = Date.now()): number {
  const remaining = deadlineAt - now - APPLY_CALL_MARGIN_MS;
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(PLATFORM_WRITE_TIMEOUT_MS, remaining);
}

/** Null when the job budget cannot cover another call. */
export function platformCallSignal(deadlineAt: number, now = Date.now()): AbortSignal | null {
  const budget = platformCallBudgetMs(deadlineAt, now);
  if (budget <= 0) return null;
  return AbortSignal.timeout(budget);
}

export function signalForPlatformCall(deadlineAt?: number, now = Date.now()): AbortSignal | null {
  if (deadlineAt == null) return AbortSignal.timeout(PLATFORM_WRITE_TIMEOUT_MS);
  return platformCallSignal(deadlineAt, now);
}

/** A signal for one call. Throws when the deadline cannot cover it, so the caller does not send. */
export function requirePlatformSignal(deadlineAt?: number, now = Date.now()): AbortSignal {
  const signal = signalForPlatformCall(deadlineAt, now);
  if (!signal) throw new ApplyCallBudgetError();
  return signal;
}

/** Used by the apply loop and by the lease test. A call with no budget is not started. */
export async function runBudgetedPlatformCalls(input: {
  deadlineAt: number;
  calls: Array<(signal: AbortSignal) => Promise<void>>;
  now?: () => number;
}): Promise<{ ran: number; skipped: number; elapsedMs: number }> {
  const clock = input.now ?? Date.now;
  const started = clock();
  let ran = 0;
  let skipped = 0;
  for (const call of input.calls) {
    const signal = platformCallSignal(input.deadlineAt, clock());
    if (!signal) {
      skipped += 1;
      continue;
    }
    try {
      await call(signal);
    } catch (error) {
      const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
      if (name !== "TimeoutError" && name !== "AbortError") throw error;
    }
    ran += 1;
  }
  return { ran, skipped, elapsedMs: clock() - started };
}
