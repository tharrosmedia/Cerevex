/**
 * Soft-launch Approve allowlist — identity, not a capability.
 * Single path: APPROVE_OPERATOR_EMAILS (default adam@tharrosmedia.com).
 * SEED_OWNER_EMAIL is seed-only. Kill switch + freeze + apply still apply.
 */

export {
  APPROVE_OPERATOR_EMAILS_ENV,
  DEFAULT_APPROVE_OPERATOR_EMAIL,
  approveOperatorEmails,
  canApproveApply,
} from "@shopify-brain/contracts";
