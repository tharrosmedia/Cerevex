/**
 * Authorization grant (v0). Required before optional execute.
 * OS apply and Brain publish both check expires_at / revoked_at.
 */

export type AuthorizationGrant = {
  id: string;
  workspaceId: string;
  clientId?: string | null;
  actorId: string;
  actorType: "user" | "system";
  entityType: string;
  entityId: string;
  decisionId?: string | null;
  scopeJson: Record<string, unknown>;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function isGrantActive(grant: AuthorizationGrant, at: Date = new Date()): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= at.getTime()) return false;
  return true;
}
