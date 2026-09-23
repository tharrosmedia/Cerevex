/**
 * Soft-launch Approve allowlist.
 * Default: seeded owner adam@tharrosmedia.com.
 * Override with APPROVE_OPERATOR_EMAILS (comma-separated).
 * Browser-safe: process.env only.
 */

export const DEFAULT_APPROVE_OPERATOR_EMAIL = "adam@tharrosmedia.com";

export function approveOperatorEmails(): string[] {
  const raw = process.env.APPROVE_OPERATOR_EMAILS ?? process.env.SEED_OWNER_EMAIL ?? DEFAULT_APPROVE_OPERATOR_EMAIL;
  const emails = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return emails.length > 0 ? emails : [DEFAULT_APPROVE_OPERATOR_EMAIL];
}

export function canApproveApply(email: string | null | undefined): boolean {
  if (!email) return false;
  return approveOperatorEmails().includes(email.toLowerCase());
}
