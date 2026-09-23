/**
 * Remaining ops / env knobs after G8. Secrets stay env secrets.
 * Product switches map to capabilities. Identity stays an allowlist.
 */

import type { CapabilityId } from "./capabilities";

export const OPS_ENV_KINDS = ["capability_kill", "capability_companion", "identity", "secret"] as const;
export type OpsEnvKind = (typeof OPS_ENV_KINDS)[number];

export type OpsEnvEntry = {
  env: string;
  kind: OpsEnvKind;
  capability?: CapabilityId;
  help: string;
};

export const OPS_ENV_REGISTRY: readonly OpsEnvEntry[] = [
  {
    env: "CAPABILITY_KILL",
    kind: "capability_kill",
    help: "Comma-separated capability ids to hide globally without a Site Brain redeploy.",
  },
  {
    env: "FEATURE_BID_MUTATIONS",
    kind: "capability_kill",
    capability: "apply.bid",
    help: "Legacy kill when 0 / false / off. Prefer Settings → apply.bid or CAPABILITY_KILL_APPLY_BID=1.",
  },
  {
    env: "FEATURE_BUDGET_MUTATIONS",
    kind: "capability_kill",
    capability: "apply.budget",
    help: "Legacy kill when 0 / false / off. Prefer Settings → apply.budget or CAPABILITY_KILL_APPLY_BUDGET=1.",
  },
  {
    env: "PLATFORM_SYNC_LIVE",
    kind: "capability_kill",
    capability: "sync.live",
    help: "Legacy kill when 0 / false / off. Prefer Settings → sync.live or CAPABILITY_KILL_SYNC_LIVE=1.",
  },
  {
    env: "NEXT_PUBLIC_ADS_LEGACY_CHROME",
    kind: "capability_companion",
    capability: "shell.legacy_ads_web",
    help: "Deploy-time console link allow. Set to 1 only with NEXT_PUBLIC_ADS_ORIGIN. Console emits leftover chrome links only when this is 1 AND shell.legacy_ads_web is on. Not a second product flag.",
  },
  {
    env: "APPROVE_OPERATOR_EMAILS",
    kind: "identity",
    help: "Soft-launch Approve allowlist (comma-separated). Default adam@tharrosmedia.com. Not a capability — do not store emails in settings_json. Still ANDed with apply + kill switch + freeze.",
  },
  {
    env: "APP_PASSWORD",
    kind: "secret",
    help: "Brain console session cookie only. Not ads JWT. Not a feature flag. Do not bolt ads RBAC onto this.",
  },
  {
    env: "JWT_SECRET",
    kind: "secret",
    help: "Ads user sessions (email/password). Separate from Brain APP_PASSWORD.",
  },
  {
    env: "ADS_INTERNAL_KEY",
    kind: "secret",
    help: "Server-side Brain BFF → ads API service key (x-cerevex-internal-key). Acts as the seeded owner. Never expose to the browser.",
  },
  {
    env: "ADS_API_TOKEN",
    kind: "secret",
    help: "Optional ads JWT the Brain BFF can send as Bearer. Not a feature flag.",
  },
  {
    env: "TOKEN_ENCRYPTION_KEY",
    kind: "secret",
    help: "Encrypts OAuth tokens at rest in schema os. Not a feature flag.",
  },
];

export function opsEnvSecrets(): readonly OpsEnvEntry[] {
  return OPS_ENV_REGISTRY.filter((entry) => entry.kind === "secret");
}

export function opsEnvCapabilityKills(): readonly OpsEnvEntry[] {
  return OPS_ENV_REGISTRY.filter((entry) => entry.kind === "capability_kill" && entry.capability);
}
