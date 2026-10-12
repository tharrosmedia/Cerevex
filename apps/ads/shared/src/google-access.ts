import { googleAdsDeveloperToken } from "./env";
import { GOOGLE_ADS_API_VERSION } from "./google-ads";
import type { GoogleReadiness } from "./oauth";

export const GOOGLE_NOT_CONFIGURED_MESSAGE = "Google Ads isn't set up on this server yet.";

export const GOOGLE_PROJECT_NOT_APPROVED_MESSAGE =
  "Google hasn't approved Cerevex's Google Cloud project for live accounts yet. Apply for Explorer access in Google Cloud.";

export const GOOGLE_NEEDS_RECONNECT_MESSAGE = "Google sign-in expired. Reconnect Google Ads for this site.";

export const GOOGLE_PERMISSION_DENIED_MESSAGE =
  "Google Ads API isn't enabled for this project, or this login doesn't have permission.";

export const GOOGLE_READY_MESSAGE = "Ready";

export const GOOGLE_ACCESS_UNKNOWN_MESSAGE = "Couldn't check Google Ads access.";

export const GOOGLE_PROJECT_NOT_APPROVED_CODE = "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION";

export const GOOGLE_READINESS_CHECKED = "google.readiness_checked";

/** Plain result of Check Google Ads access. Messages are fixed sentences, never a Google body. */
export type GoogleAccessStatus =
  | "ok"
  | "not_configured"
  | "needs_reconnect"
  | "permission_denied"
  | "project_not_approved"
  | "unknown";

export type GoogleAccessCheck = {
  status: GoogleAccessStatus;
  readiness: GoogleReadiness;
  message: string;
  checkedAt: string;
};

const LIST_ACCESSIBLE_CUSTOMERS = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`;

export function messageForGoogleAccess(status: GoogleAccessStatus): string {
  switch (status) {
    case "ok":
      return GOOGLE_READY_MESSAGE;
    case "not_configured":
      return GOOGLE_NOT_CONFIGURED_MESSAGE;
    case "needs_reconnect":
      return GOOGLE_NEEDS_RECONNECT_MESSAGE;
    case "permission_denied":
      return GOOGLE_PERMISSION_DENIED_MESSAGE;
    case "project_not_approved":
      return GOOGLE_PROJECT_NOT_APPROVED_MESSAGE;
    case "unknown":
      return GOOGLE_ACCESS_UNKNOWN_MESSAGE;
  }
}

export function readinessForGoogleAccess(status: GoogleAccessStatus): GoogleReadiness {
  switch (status) {
    case "ok":
      return "ready";
    case "not_configured":
      return "not_configured";
    case "project_not_approved":
      return "project_not_approved";
    default:
      return "unknown";
  }
}

export function googleAccessCheck(status: GoogleAccessStatus, now = new Date()): GoogleAccessCheck {
  return {
    status,
    readiness: readinessForGoogleAccess(status),
    message: messageForGoogleAccess(status),
    checkedAt: now.toISOString(),
  };
}

function bodyBlob(body: unknown): string {
  if (body == null) return "";
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

/**
 * Map a listAccessibleCustomers response to a status.
 * The Google body is used only to pick a code. It is not returned.
 */
export function classifyGoogleAdsHttp(status: number, body: unknown): GoogleAccessStatus {
  const blob = bodyBlob(body);
  if (blob.includes(GOOGLE_PROJECT_NOT_APPROVED_CODE)) return "project_not_approved";
  if (status === 401 || blob.includes("invalid_grant") || blob.includes("UNAUTHENTICATED")) {
    return "needs_reconnect";
  }
  if (
    status === 403 ||
    blob.includes("PERMISSION_DENIED") ||
    blob.includes("SERVICE_DISABLED") ||
    blob.includes("API has not been used")
  ) {
    return "permission_denied";
  }
  if (status >= 200 && status < 300) return "ok";
  return "unknown";
}

/**
 * One listAccessibleCustomers call.
 * Uses googleAdsDeveloperToken() as list does: the header is sent only when that
 * value is present. A missing token does not block the call.
 */
export async function probeGoogleListAccessibleCustomers(
  accessToken: string,
  now = new Date(),
): Promise<GoogleAccessCheck> {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  const developerToken = googleAdsDeveloperToken();
  if (developerToken) headers["developer-token"] = developerToken;
  try {
    const res = await fetch(LIST_ACCESSIBLE_CUSTOMERS, { headers });
    const body = await res.json().catch(() => null);
    return googleAccessCheck(classifyGoogleAdsHttp(res.status, body), now);
  } catch {
    return googleAccessCheck("unknown", now);
  }
}

/** Drop anything except the four public fields, then refuse a body that still contains a secret. */
export function sealGoogleAccessCheck(check: GoogleAccessCheck, secrets: readonly string[]): GoogleAccessCheck {
  const sealed = googleAccessCheck(check.status, new Date(check.checkedAt));
  const text = JSON.stringify(sealed);
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      return googleAccessCheck("unknown", new Date(check.checkedAt));
    }
  }
  return sealed;
}
