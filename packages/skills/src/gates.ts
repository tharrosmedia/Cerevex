import type { GateDecision, InScopeClientSlug, SkillRunKind } from "./types";

/** Brief §3.4. Only these six clients may exist as skill tenants. */
export const IN_SCOPE_CLIENT_SLUGS = [
  "hvac-usa",
  "got-ductless",
  "kc-prestige-hvac",
  "elmar-hvac",
  "tharros-media",
  "cerevex",
] as const satisfies readonly InScopeClientSlug[];

/**
 * Level Agency tenants. They never get a tenant row or a skill/job run.
 * Names are the brief's list (Edge NYC, Vessel NYC, Kiavi, Perfect Lens World
 * or CA, Lenspure).
 */
export const LEVEL_AGENCY_TENANTS = [
  { slug: "edge-nyc", name: "Edge NYC" },
  { slug: "vessel-nyc", name: "Vessel NYC" },
  { slug: "kiavi", name: "Kiavi" },
  { slug: "perfect-lens-world", name: "Perfect Lens World" },
  { slug: "perfect-lens-ca", name: "Perfect Lens CA" },
  { slug: "lenspure", name: "Lenspure" },
] as const;

const LEVEL_AGENCY_KEYS = new Set<string>([
  ...LEVEL_AGENCY_TENANTS.map((tenant) => tenant.slug),
  "perfect-lens-world-ca",
  "perfect-lens-world-or-ca",
]);

export function normalizeTenantKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isInScopeClient(slugOrName: string): slugOrName is InScopeClientSlug {
  return (IN_SCOPE_CLIENT_SLUGS as readonly string[]).includes(normalizeTenantKey(slugOrName));
}

export function isLevelAgencyTenant(slugOrName: string): boolean {
  return LEVEL_AGENCY_KEYS.has(normalizeTenantKey(slugOrName));
}

export function marketingGateFromStatus(status: string): "on" | "off" {
  const plain = status.replace(/\*/g, "").toLowerCase();
  if (plain.includes("not marketed")) return "on";
  return "off";
}

/**
 * Scope and marketing gates. Enforced here, in config, not in skill prompts.
 * A marketing gate of "on" means marketing and qualified-outcome work is blocked.
 */
export function evaluateSkillRun(input: {
  clientSlug: string;
  runKind: SkillRunKind;
  marketingGate?: "on" | "off" | null;
}): GateDecision {
  if (isLevelAgencyTenant(input.clientSlug)) {
    return {
      allowed: false,
      gate: "scope",
      reason: `Scope gate: ${input.clientSlug} is a Level Agency tenant. No skill or job run is allowed.`,
    };
  }
  if (!isInScopeClient(input.clientSlug)) {
    return {
      allowed: false,
      gate: "scope",
      reason: `Scope gate: ${input.clientSlug} is not one of the six in-scope clients.`,
    };
  }
  const blockedKind = input.runKind === "marketing" || input.runKind === "qualified-outcome";
  if (blockedKind && input.marketingGate === "on") {
    return {
      allowed: false,
      gate: "marketing",
      reason:
        "Marketing gate: status is internal tool, not marketed. No marketing or qualified-outcome work. Internal recommendation records are still allowed.",
    };
  }
  return { allowed: true, gate: null, reason: null };
}

export class SkillGateError extends Error {
  readonly decision: GateDecision;

  constructor(decision: GateDecision) {
    super(decision.reason ?? "Skill run blocked");
    this.name = "SkillGateError";
    this.decision = decision;
  }
}

export function assertSkillRunAllowed(input: {
  clientSlug: string;
  runKind: SkillRunKind;
  marketingGate?: "on" | "off" | null;
}): void {
  const decision = evaluateSkillRun(input);
  if (!decision.allowed) throw new SkillGateError(decision);
}
