import type { SecurityAuditEntry } from "./audit";

const MAX_COUNT = 100_000;

/** Methods an aggregated row may keep. Anything else collapses to one bucket. */
export const AUDIT_BUCKET_METHODS = ["initialize", "tools/list", "tools/call", "resources/read", "prompts/get"] as const;
const BUCKET_METHODS = new Set<string>(AUDIT_BUCKET_METHODS);

function forBucket(entry: SecurityAuditEntry): SecurityAuditEntry {
  const method = entry.method && BUCKET_METHODS.has(entry.method) ? entry.method : null;
  const tool = entry.authType === "unauthenticated" ? null : entry.tool;
  return { ...entry, method, tool };
}

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
      const bucketed = forBucket(entry);
      const key = bucketKey(bucketed);
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, { ...bucketed, count: 1 });
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
