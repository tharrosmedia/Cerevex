/**
 * Soft-launch Approve identity allowlist.
 *
 * This is not a capability. Emails must not live in settings_json.
 * Product writes still require `apply` + kill switch + freeze (Authorize-to-Apply).
 *
 * Single path: APPROVE_OPERATOR_EMAILS (comma-separated).
 * Default: adam@tharrosmedia.com. Empty / missing falls back to that default.
 * SEED_OWNER_EMAIL is seed-only — it does not grant Approve.
 */

import { type ProcessEnvMap, readProcessEnv } from "./capabilities";

export const APPROVE_OPERATOR_EMAILS_ENV = "APPROVE_OPERATOR_EMAILS" as const;
export const DEFAULT_APPROVE_OPERATOR_EMAIL = "adam@tharrosmedia.com";

export function approveOperatorEmails(env: ProcessEnvMap = readProcessEnv()): string[] {
  const raw = env[APPROVE_OPERATOR_EMAILS_ENV] ?? DEFAULT_APPROVE_OPERATOR_EMAIL;
  const emails = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? emails : [DEFAULT_APPROVE_OPERATOR_EMAIL];
}

export function canApproveApply(
  email: string | null | undefined,
  env: ProcessEnvMap = readProcessEnv(),
): boolean {
  if (!email) return false;
  return approveOperatorEmails(env).includes(email.toLowerCase());
}
