/**
 * Cerevex capability flag registry (modularity retrofit).
 *
 * Per-workspace product capabilities beyond Modules & Nav IA.
 * Optional env global kill can hide a capability without redeploy.
 *
 * States:
 * - on — available
 * - hidden — unfinished / off; UI hides, writes refuse safely
 * - recommend_only — visible as a recommendation, no writes
 *
 * Env kills (any one is enough):
 * - CAPABILITY_KILL=apply,connect.meta
 * - CAPABILITY_KILL_APPLY=1  (dots → underscores, uppercased)
 * - FEATURE_BID_MUTATIONS=0 / FEATURE_BUDGET_MUTATIONS=0 (legacy → apply.bid / apply.budget)
 */

export const CAPABILITY_STATES = ["on", "hidden", "recommend_only"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const CAPABILITY_IDS = [
  "cockpit",
  "apply",
  "connect.meta",
  "connect.google",
  "audits",
  "apply.bid",
  "apply.budget",
  "apply.create_entity",
  "shell.legacy_ads_web",
  "m51.budget_shift",
  "m51.grok_creatives",
  "m51.lp_congruence",
  "m51.ga4_connect",
  "m51.brainstorm",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityFlags = Record<CapabilityId, CapabilityState>;
export type CapabilityOverrides = Partial<Record<CapabilityId, CapabilityState>>;

export type CapabilityCatalogEntry = {
  id: CapabilityId;
  label: string;
  help: string;
  defaultState: CapabilityState;
  unfinished: boolean;
  group: "product" | "apply" | "shell" | "m51";
};

export const CAPABILITY_CATALOG: Record<CapabilityId, CapabilityCatalogEntry> = {
  cockpit: {
    id: "cockpit",
    label: "Ads cockpit",
    help: "In-shell Ads home, suggestions, and read path.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  apply: {
    id: "apply",
    label: "Apply",
    help: "Approve queues async platform writes. Kill switch and freeze still apply.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "connect.meta": {
    id: "connect.meta",
    label: "Connect Meta",
    help: "Start Meta OAuth or mock connect for this workspace.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "connect.google": {
    id: "connect.google",
    label: "Connect Google",
    help: "Start Google Ads OAuth or mock connect for this workspace.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  audits: {
    id: "audits",
    label: "Audits",
    help: "Run ads checks. Existing findings stay readable when this is off.",
    defaultState: "on",
    unfinished: false,
    group: "product",
  },
  "apply.bid": {
    id: "apply.bid",
    label: "Bid mutations",
    help: "Allow update_bid under Approve. Legacy env: FEATURE_BID_MUTATIONS.",
    defaultState: "on",
    unfinished: false,
    group: "apply",
  },
  "apply.budget": {
    id: "apply.budget",
    label: "Budget mutations",
    help: "Allow update_budget under Approve. Legacy env: FEATURE_BUDGET_MUTATIONS.",
    defaultState: "on",
    unfinished: false,
    group: "apply",
  },
  "apply.create_entity": {
    id: "apply.create_entity",
    label: "Create-entity apply",
    help: "Sealed job type for later Grok create-ad / add-keyword. Off until that path ships.",
    defaultState: "hidden",
    unfinished: true,
    group: "apply",
  },
  "shell.legacy_ads_web": {
    id: "shell.legacy_ads_web",
    label: "Legacy ads-web chrome",
    help: "Leftover apps/ads/web cockpit. Default hidden — operator path is in-shell /ads.",
    defaultState: "hidden",
    unfinished: true,
    group: "shell",
  },
  "m51.budget_shift": {
    id: "m51.budget_shift",
    label: "Budget shift (M5.1)",
    help: "Dark placeholder. No budget-shift UI in this retrofit.",
    defaultState: "hidden",
    unfinished: true,
    group: "m51",
  },
  "m51.grok_creatives": {
    id: "m51.grok_creatives",
    label: "Grok creatives (M5.1)",
    help: "Dark placeholder. No Grok creative work in this retrofit.",
    defaultState: "hidden",
    unfinished: true,
    group: "m51",
  },
  "m51.lp_congruence": {
    id: "m51.lp_congruence",
    label: "Landing-page congruence (M5.1)",
    help: "Dark placeholder. No LP analysis in this retrofit.",
    defaultState: "hidden",
    unfinished: true,
    group: "m51",
  },
  "m51.ga4_connect": {
    id: "m51.ga4_connect",
    label: "GA4 connect (M5.1)",
    help: "Dark placeholder. Connector stub only — no GA4 connect UX.",
    defaultState: "hidden",
    unfinished: true,
    group: "m51",
  },
  "m51.brainstorm": {
    id: "m51.brainstorm",
    label: "Brainstorm (M5.1)",
    help: "Dark placeholder. No brainstorm product work in this retrofit.",
    defaultState: "hidden",
    unfinished: true,
    group: "m51",
  },
};

export const CAPABILITY_CATALOG_LIST: CapabilityCatalogEntry[] = CAPABILITY_IDS.map(
  (id) => CAPABILITY_CATALOG[id],
);

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && (CAPABILITY_IDS as readonly string[]).includes(value);
}

export function isCapabilityState(value: unknown): value is CapabilityState {
  return typeof value === "string" && (CAPABILITY_STATES as readonly string[]).includes(value);
}

export function defaultCapabilityFlags(): CapabilityFlags {
  const flags = {} as CapabilityFlags;
  for (const id of CAPABILITY_IDS) {
    flags[id] = CAPABILITY_CATALOG[id].defaultState;
  }
  return flags;
}

export function capabilityEnvKillKey(id: CapabilityId): string {
  return `CAPABILITY_KILL_${id.replace(/\./g, "_").toUpperCase()}`;
}

function envTruthy(raw: string | undefined): boolean {
  if (raw == null || raw === "") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function envExplicitOff(raw: string | undefined): boolean {
  if (raw == null || raw === "") return false;
  const value = raw.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

type EnvMap = Record<string, string | undefined>;

/** Browser-safe. Reads process.env when present — no node:fs, no @types/node. */
export function readProcessEnv(): EnvMap {
  const runtime = globalThis as { process?: { env?: EnvMap } };
  return runtime.process?.env ?? {};
}

export function envCapabilityKills(env: EnvMap = readProcessEnv()): CapabilityId[] {
  const kills = new Set<CapabilityId>();
  const list = env.CAPABILITY_KILL ?? "";
  for (const part of list.split(",")) {
    const id = part.trim();
    if (isCapabilityId(id)) kills.add(id);
  }
  for (const id of CAPABILITY_IDS) {
    if (envTruthy(env[capabilityEnvKillKey(id)])) kills.add(id);
  }
  if (envExplicitOff(env.FEATURE_BID_MUTATIONS)) kills.add("apply.bid");
  if (envExplicitOff(env.FEATURE_BUDGET_MUTATIONS)) kills.add("apply.budget");
  return [...kills];
}

export function parseCapabilityOverrides(raw: unknown): CapabilityOverrides {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const next: CapabilityOverrides = {};
  for (const id of CAPABILITY_IDS) {
    if (isCapabilityState(input[id])) next[id] = input[id];
  }
  return next;
}

export function mergeCapabilityFlags(
  overrides: CapabilityOverrides | null | undefined,
  fallback: CapabilityFlags = defaultCapabilityFlags(),
): CapabilityFlags {
  const next = { ...fallback };
  if (!overrides) return next;
  for (const id of CAPABILITY_IDS) {
    const value = overrides[id];
    if (isCapabilityState(value)) next[id] = value;
  }
  return next;
}

export function applyEnvKills(
  flags: CapabilityFlags,
  env: EnvMap = readProcessEnv(),
): CapabilityFlags {
  const next = { ...flags };
  for (const id of envCapabilityKills(env)) {
    next[id] = "hidden";
  }
  return next;
}

/**
 * Resolve stored settings_json.capabilities + catalog defaults + env kills.
 * Never throws. Missing / garbage JSON → defaults.
 */
export function resolveWorkspaceCapabilities(
  settingsJson: unknown,
  env: EnvMap = readProcessEnv(),
): CapabilityFlags {
  const obj = settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
    ? (settingsJson as Record<string, unknown>)
    : {};
  const stored = parseCapabilityOverrides(obj.capabilities ?? obj);
  return applyEnvKills(mergeCapabilityFlags(stored), env);
}

export function settingsJsonWithCapabilityOverrides(
  existing: Record<string, unknown>,
  overrides: CapabilityOverrides,
): Record<string, unknown> {
  const current = parseCapabilityOverrides(existing.capabilities);
  return {
    ...existing,
    capabilities: { ...current, ...parseCapabilityOverrides(overrides) },
  };
}

export function isCapabilityOn(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on";
}

export function isCapabilityVisible(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on" || flags[id] === "recommend_only";
}

export function isCapabilityWritable(id: CapabilityId, flags: CapabilityFlags): boolean {
  return flags[id] === "on";
}

/** Leftover ads-web chrome is break-glass only. Default hidden. */
export function isLegacyAdsWebAllowed(flags: CapabilityFlags): boolean {
  return isCapabilityWritable("shell.legacy_ads_web", flags);
}

/** Approve may queue writes only when apply is on (not hidden / recommend_only). */
export function isApplyEnabled(flags: CapabilityFlags): boolean {
  return isCapabilityWritable("apply", flags);
}

export function canApproveWithApply(operatorCanApprove: boolean, flags: CapabilityFlags): boolean {
  return Boolean(operatorCanApprove) && isApplyEnabled(flags);
}

export type LegacyAdsWebGate = "loading" | "unauthenticated" | "allow" | "block";

/**
 * Hard-gate leftover /app/* chrome. Fail closed once a session exists.
 * Sign-in stays available so an operator can authenticate, then get redirected.
 */
export function legacyAdsWebGate(input: {
  loading: boolean;
  authenticated: boolean;
  capabilities: CapabilityFlags;
}): LegacyAdsWebGate {
  if (input.loading) return "loading";
  if (!input.authenticated) return "unauthenticated";
  return isLegacyAdsWebAllowed(input.capabilities) ? "allow" : "block";
}

export function capabilityBlockMessage(id: CapabilityId, state: CapabilityState | undefined): string {
  const label = CAPABILITY_CATALOG[id]?.label ?? id;
  if (state === "recommend_only") {
    return `${label} is recommend-only for this workspace. Nothing was written.`;
  }
  return `${label} is off for this workspace.`;
}

export function filterItemsByCapabilities<T extends { capability?: CapabilityId }>(
  items: T[],
  flags: CapabilityFlags,
): T[] {
  return items.filter((item) => item.capability == null || isCapabilityVisible(item.capability, flags));
}
