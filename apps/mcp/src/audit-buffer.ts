import type { SecurityAuditEntry } from "./audit";

const MAX_COUNT = 100_000;

function bucketKey(entry: SecurityAuditEntry): string {
  return [entry.reason, entry.result, entry.httpStatus, entry.method ?? "", entry.tool ?? "", entry.identityId ?? ""].join(
    "\n",
  );
}

/** Collapses repeated denials into one audit row per window. */
export function createDeniedAuditAggregator() {
  const buckets = new Map<string, SecurityAuditEntry>();
  return {
    add(entry: SecurityAuditEntry) {
      const key = bucketKey(entry);
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, { ...entry, count: 1 });
        return;
      }
      existing.count = Math.min(MAX_COUNT, existing.count + 1);
      existing.latencyMs = Math.max(existing.latencyMs, entry.latencyMs);
    },
    drain(): SecurityAuditEntry[] {
      const rows = [...buckets.values()];
      buckets.clear();
      return rows;
    },
  };
}
