export function formatWhen(value: string | null | undefined, fallback = "never"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

export function formatMoney(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `$${amount.toFixed(2)}`;
}

export function platformLabel(platform: string): string {
  return platform === "google" ? "Google Ads" : platform === "meta" ? "Meta" : platform;
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function findingDetail(body: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const ruleId = typeof body.ruleId === "string" ? body.ruleId : null;
  if (ruleId) parts.push(ruleId);
  if (typeof body.hint === "string") parts.push(body.hint);
  if (typeof body.spend30dUsd === "string") parts.push(`30d spend $${body.spend30dUsd}`);
  if (typeof body.cpa30dUsd === "string") parts.push(`CPA $${body.cpa30dUsd}`);
  if (typeof body.ctr === "number") parts.push(`CTR ${(body.ctr * 100).toFixed(2)}%`);
  if (typeof body.entityCount === "number") parts.push(`${body.entityCount} entities`);
  return parts.length ? parts.join(" · ") : null;
}

export type ProposedMutationView = {
  platform?: string;
  action?: string;
  execute?: boolean;
  targetName?: string;
};

export function asProposedMutations(value: unknown[]): ProposedMutationView[] {
  return value.map((row) => {
    if (!row || typeof row !== "object") return {};
    const rec = row as Record<string, unknown>;
    const target = rec.target && typeof rec.target === "object" ? (rec.target as Record<string, unknown>) : {};
    return {
      platform: typeof rec.platform === "string" ? rec.platform : undefined,
      action: typeof rec.action === "string" ? rec.action : undefined,
      execute: rec.execute === true,
      targetName: typeof target.name === "string" ? target.name : undefined,
    };
  });
}
