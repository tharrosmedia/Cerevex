import { titleCase } from "./ads-copy";

const TYPE_LABELS: Record<string, string> = {
  "seo.generate": "SEO create",
  "seo.create": "SEO create",
  "seo.optimize": "SEO refresh",
  "seo.refresh": "SEO refresh",
  "seo.publish": "Publish SEO page",
  "seo.research": "SEO research",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  publishing: "Publishing",
  awaiting_approval: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Done",
  failed: "Failed",
};

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function jobTypeLabel(type: string | null | undefined): string {
  if (!type) return "Job";
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  return titleCase(type.replace(/^seo[._]/, "").replace(/[._]/g, " "));
}

export function jobStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return STATUS_LABELS[status] ?? titleCase(status);
}

export type StatusTone = "trust" | "warn" | "danger" | "info";

/** Design Standards 1.2 status accents: completed/approved=trust, queued=warn, failed/rejected=danger. */
export function jobStatusTone(status: string | null | undefined): StatusTone {
  const value = (status || "").toLowerCase();
  if (value === "completed" || value === "approved" || value === "published" || value === "done") {
    return "trust";
  }
  if (value === "failed" || value === "rejected" || value === "error") {
    return "danger";
  }
  if (
    value === "queued" ||
    value === "pending" ||
    value === "running" ||
    value === "publishing" ||
    value === "awaiting_approval"
  ) {
    return "warn";
  }
  return "info";
}

export function jobInputLabel(input: unknown, type?: string | null): string {
  const record = asRecord(input);
  if (!record) return "No details";

  const keyword = firstString(record, ["keyword", "query", "topic", "title", "name", "url"]);
  const mode = firstString(record, ["mode"]);
  if (keyword) {
    const kind = type ? jobTypeLabel(type) : mode ? `SEO ${mode}` : "SEO";
    return `${kind} — ${keyword}`;
  }

  const keys = Object.keys(record).filter((key) => {
    const value = record[key];
    return value != null && value !== "" && typeof value !== "object";
  });
  if (keys.length === 0) return "No details";
  return keys
    .slice(0, 2)
    .map((key) => {
      const value = record[key];
      return `${titleCase(key)}: ${String(value)}`;
    })
    .join(" · ");
}

export function jobInputDetails(input: unknown): string[] {
  const record = asRecord(input);
  if (!record) return [];
  return Object.entries(record)
    .filter(([, value]) => value != null && value !== "" && typeof value !== "object")
    .map(([key, value]) => `${titleCase(key)}: ${String(value)}`);
}
