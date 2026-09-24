import {
  isSiteCmsResourceType,
  type SiteCmsApplyPayload,
  type SiteCmsApplyResult,
} from "@cerevex/contracts";

const ALLOWED_APPLY_KEYS = new Set([
  "approved",
  "approvalId",
  "approvedAt",
  "storeId",
  "externalId",
  "resourceType",
  "title",
  "bodyHtml",
  "seoTitle",
  "seoDescription",
]);

export function validateApprovedApplyPayload(raw: unknown): { ok: true; payload: SiteCmsApplyPayload } | SiteCmsApplyResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, writes: false, code: "invalid_payload", reason: "That change is not valid." };
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_APPLY_KEYS.has(key)) {
      return { ok: false, writes: false, code: "unsupported_field", reason: "Only title, body, and meta can be changed." };
    }
  }
  if (input.approved !== true) {
    return { ok: false, writes: false, code: "unapproved", reason: "The site rejected an unapproved change. Nothing was written." };
  }
  if (typeof input.approvalId !== "string" || !input.approvalId.trim()) {
    return { ok: false, writes: false, code: "unapproved", reason: "The site rejected an unapproved change. Nothing was written." };
  }
  if (typeof input.approvedAt !== "string" || !input.approvedAt.trim()) {
    return { ok: false, writes: false, code: "unapproved", reason: "The site rejected an unapproved change. Nothing was written." };
  }
  if (typeof input.storeId !== "string" || !input.storeId.trim()) {
    return { ok: false, writes: false, code: "invalid_payload", reason: "That change is not valid." };
  }
  if (typeof input.externalId !== "string" || !input.externalId.trim()) {
    return { ok: false, writes: false, code: "invalid_payload", reason: "That change is not valid." };
  }
  if (!isSiteCmsResourceType(input.resourceType)) {
    return { ok: false, writes: false, code: "invalid_payload", reason: "That change is not valid." };
  }
  const hasMutation =
    input.title != null ||
    input.bodyHtml != null ||
    input.seoTitle != null ||
    input.seoDescription != null;
  if (!hasMutation) {
    return { ok: false, writes: false, code: "invalid_payload", reason: "That change is not valid." };
  }
  return {
    ok: true,
    payload: {
      approved: true,
      approvalId: input.approvalId.trim(),
      approvedAt: input.approvedAt,
      storeId: input.storeId.trim(),
      externalId: String(input.externalId).trim(),
      resourceType: input.resourceType,
      title: typeof input.title === "string" ? input.title : undefined,
      bodyHtml: typeof input.bodyHtml === "string" ? input.bodyHtml : undefined,
      seoTitle: typeof input.seoTitle === "string" ? input.seoTitle : undefined,
      seoDescription: typeof input.seoDescription === "string" ? input.seoDescription : undefined,
    },
  };
}
