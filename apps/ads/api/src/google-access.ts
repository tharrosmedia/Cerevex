import { and, desc, eq } from "drizzle-orm";
import type { AuthContext } from "@tharros/ads-shared";
import { workspaceRole } from "@tharros/ads-shared";
import { writeAuditEvent } from "@tharros/ads-shared/audit";
import { decryptSecret } from "@tharros/ads-shared/crypto";
import { getDb } from "@tharros/ads-shared/db";
import {
  GOOGLE_READINESS_CHECKED,
  googleAccessCheck,
  probeGoogleListAccessibleCustomers,
  sealGoogleAccessCheck,
  type GoogleAccessCheck,
} from "@tharros/ads-shared/google-access";
import { isGoogleConfigured } from "@tharros/ads-shared/oauth";
import { oauthCredentials } from "@tharros/ads-shared/schema";
import type { StoredOAuthTokens } from "@tharros/ads-shared";
import { isServicePrincipal } from "./auth";

export const GOOGLE_ACCESS_OWNER_ONLY = "Only a workspace owner can check Google Ads access.";

export function googleAccessAllowed(auth: AuthContext, workspaceId: string): boolean {
  return !isServicePrincipal(auth) && workspaceRole(auth, workspaceId) === "owner";
}

async function loadWorkspaceGoogleAccessToken(workspaceId: string): Promise<StoredOAuthTokens | null> {
  const rows = await getDb()
    .select({ encryptedPayload: oauthCredentials.encryptedPayload })
    .from(oauthCredentials)
    .where(and(eq(oauthCredentials.workspaceId, workspaceId), eq(oauthCredentials.platform, "google")))
    .orderBy(desc(oauthCredentials.updatedAt));
  for (const row of rows) {
    if (!row.encryptedPayload) continue;
    try {
      const parsed = JSON.parse(decryptSecret(row.encryptedPayload)) as StoredOAuthTokens;
      if (parsed.mock || !parsed.accessToken) continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function secretValues(tokens: StoredOAuthTokens | null): string[] {
  return [
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    tokens?.accessToken ?? "",
    tokens?.refreshToken ?? "",
  ].filter((value) => value.length >= 8);
}

export async function runGoogleAdsAccessCheck(workspaceId: string, now = new Date()): Promise<GoogleAccessCheck> {
  if (!isGoogleConfigured()) return googleAccessCheck("not_configured", now);
  const tokens = await loadWorkspaceGoogleAccessToken(workspaceId);
  const check = !tokens
    ? googleAccessCheck("needs_reconnect", now)
    : await probeGoogleListAccessibleCustomers(tokens.accessToken, now);
  return sealGoogleAccessCheck(check, secretValues(tokens));
}

export async function auditGoogleReadiness(input: {
  workspaceId: string;
  actorType: string;
  actorId?: string | null;
  allowed: boolean;
  check?: GoogleAccessCheck;
}): Promise<void> {
  const payload: Record<string, unknown> = { allowed: input.allowed };
  if (input.allowed && input.check) {
    payload.status = input.check.status;
    payload.readiness = input.check.readiness;
    payload.message = input.check.message;
    payload.checkedAt = input.check.checkedAt;
  }
  await writeAuditEvent({
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: GOOGLE_READINESS_CHECKED,
    entityType: "workspace",
    entityId: input.workspaceId,
    payload,
  });
}
