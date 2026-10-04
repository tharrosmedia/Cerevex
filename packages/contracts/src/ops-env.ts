/**
 * Remaining ops / env knobs after G8. Secrets stay env secrets.
 * Product switches map to capabilities. Identity stays an allowlist.
 */

import type { CapabilityId } from "./capabilities";

export const OPS_ENV_KINDS = ["capability_kill", "capability_companion", "identity", "secret"] as const;
export type OpsEnvKind = (typeof OPS_ENV_KINDS)[number];

/** Which process must have this value before production traffic. Workers do not use JWT_SECRET. */
export type OpsEnvRequiredIn = "brain" | "ads-api" | "ads-workers";

export type OpsEnvEntry = {
  env: string;
  kind: OpsEnvKind;
  capability?: CapabilityId;
  /**
   * Set when a production runtime must have this value.
   * Brain and ads do not share one secret list: JWT_SECRET is ads-only, ENCRYPTION_KEY is Brain-only.
   */
  requiredInProduction?: OpsEnvRequiredIn | readonly OpsEnvRequiredIn[];
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
    env: "CONSOLE_OPERATOR_EMAIL",
    kind: "identity",
    help: "Label for the shared Brain console session when checking the Approve allowlist. Not a credential: it cannot deny access on its own and does not widen access beyond APP_PASSWORD. Default adam@tharrosmedia.com.",
  },
  {
    env: "APP_PASSWORD",
    kind: "secret",
    requiredInProduction: "brain",
    help: "Brain console session cookie only. Not ads JWT. Not a feature flag. Do not bolt ads RBAC onto this. Required in a production runtime. The .env.example placeholder change-this-to-secure-password is refused in any case. Dev and test may still use that placeholder.",
  },
  {
    env: "JWT_SECRET",
    kind: "secret",
    requiredInProduction: "ads-api",
    help: "Ads user sessions (email/password). Separate from Brain APP_PASSWORD. Ads workers do not read it and do not require it to boot. Required on ads-api in a production runtime: NODE_ENV, RAILWAY_ENVIRONMENT, or RAILWAY_ENVIRONMENT_NAME equals production after trim and case-folding; or either Railway variable is any other non-empty environment name (staging and production-eu included); or CEREVEX_REQUIRE_SIGNING_SECRETS is 1, true, or yes. Cerevex Railway production is literally named production. The value is trimmed. Unset, empty, whitespace, shorter than 32 Unicode code points, or the local placeholder in any case exits ads-api boot with status 1. Dev and test use the built-in local fallback when the value is unset, empty, or whitespace, log a warning, and keep running. Never deploy the placeholder.",
  },
  {
    env: "ADS_INTERNAL_KEY",
    kind: "secret",
    requiredInProduction: "brain",
    help: "Server-side Brain BFF → ads API service key (x-cerevex-internal-key). Acts as the service principal, never a user. Cannot approve or apply. Requires ADS_INTERNAL_WORKSPACE_ID. Never expose to the browser. Header only — never a query param.",
  },
  {
    env: "ADS_INTERNAL_WORKSPACE_ID",
    kind: "identity",
    help: "Workspace UUID the internal service key is allowed to act in. Required when ADS_INTERNAL_KEY is set. One workspace only; unset or unknown refuses the request (production also exits at boot). Never inferred from the lowest workspace id. Not a secret. Do not point it at another tenant.",
  },
  {
    env: "GSC_OAUTH_STATE_SECRET",
    kind: "secret",
    requiredInProduction: "brain",
    help: "HMAC secret for the Brain Search Console OAuth state parameter. Not a feature flag.",
  },
  {
    env: "ADS_API_TOKEN",
    kind: "secret",
    help: "Optional ads JWT the Brain BFF can send as Bearer. Not a feature flag.",
  },
  {
    env: "ENCRYPTION_KEY",
    kind: "secret",
    requiredInProduction: "brain",
    help: "Brain encryption for sensitive DB fields. Required in a production runtime (same environment rule as JWT_SECRET). The raw value is never trimmed: surrounding whitespace fails closed and Brain will not boot. Not a feature flag.",
  },
  {
    env: "TOKEN_ENCRYPTION_KEY",
    kind: "secret",
    requiredInProduction: ["ads-api", "ads-workers"],
    help: "Encrypts OAuth tokens at rest in schema os. Not a feature flag. Required on ads-api and ads workers in a production runtime (same environment rule as JWT_SECRET, including any non-empty Railway environment name and CEREVEX_REQUIRE_SIGNING_SECRETS=1, true, or yes). The raw value is never trimmed, so existing ciphertext stays decryptable. Leading or trailing whitespace fails closed at boot. Unset, empty, shorter than 32 Unicode code points, or the local placeholder in any case exits ads-api and ads-worker boot with status 1. Dev and test use that placeholder only when the value is unset.",
  },
  {
    env: "CALLRAIL_API_KEY",
    kind: "secret",
    help: "Optional workspace-wide CallRail API key. Prefer the per-client encrypted store. Never put in settings_json in the clear.",
  },
  {
    env: "CALLRAIL_ACCOUNT_ID",
    kind: "secret",
    help: "Optional CallRail account id companion for CALLRAIL_API_KEY. Not a feature flag.",
  },
  {
    env: "TWILIO_ACCOUNT_SID",
    kind: "secret",
    help: "Optional workspace-wide Twilio Account SID for bundled call tracking. Prefer the per-client encrypted store. Never put in settings_json in the clear.",
  },
  {
    env: "TWILIO_AUTH_TOKEN",
    kind: "secret",
    help: "Optional Twilio Auth Token companion for TWILIO_ACCOUNT_SID. Not a feature flag.",
  },
  {
    env: "HCP_API_KEY",
    kind: "secret",
    help: "Optional workspace-wide Housecall Pro API key. Prefer the per-client encrypted store. Never put in settings_json in the clear.",
  },
  {
    env: "CLARITY_API_KEY",
    kind: "secret",
    help: "Optional workspace-wide Microsoft Clarity Data Export token. Prefer the per-client encrypted store. Never put in settings_json in the clear.",
  },
  {
    env: "CLARITY_PROJECT_ID",
    kind: "secret",
    help: "Optional Clarity project id companion for CLARITY_API_KEY. Not a feature flag.",
  },
];

export function opsEnvSecrets(): readonly OpsEnvEntry[] {
  return OPS_ENV_REGISTRY.filter((entry) => entry.kind === "secret");
}

export function opsEnvCapabilityKills(): readonly OpsEnvEntry[] {
  return OPS_ENV_REGISTRY.filter((entry) => entry.kind === "capability_kill" && entry.capability);
}

function entryRequiredIn(entry: OpsEnvEntry, target: OpsEnvRequiredIn): boolean {
  const required = entry.requiredInProduction;
  if (required == null) return false;
  if (typeof required === "string") return required === target;
  return required.includes(target);
}

/** Secrets the named process must have in a production runtime. Driven by requiredInProduction. */
export function opsEnvRequiredInProduction(target: OpsEnvRequiredIn): readonly OpsEnvEntry[] {
  return OPS_ENV_REGISTRY.filter((entry) => entryRequiredIn(entry, target));
}
