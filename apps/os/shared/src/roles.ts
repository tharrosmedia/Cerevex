import type { AuthContext, Role } from "./types";

export const WORKSPACE_WIDE_ROLES: Role[] = ["owner", "operator"];

export function isWorkspaceWide(role: Role): boolean {
  return WORKSPACE_WIDE_ROLES.includes(role);
}

export function workspaceIdsFor(ctx: AuthContext): string[] {
  return ctx.memberships.map((m) => m.workspaceId);
}

export function canAccessWorkspace(ctx: AuthContext, workspaceId: string): boolean {
  return ctx.memberships.some((m) => m.workspaceId === workspaceId);
}

export function workspaceRole(ctx: AuthContext, workspaceId: string): Role | undefined {
  return ctx.memberships.find((m) => m.workspaceId === workspaceId)?.role;
}

export function canSeeAllClientsInWorkspace(ctx: AuthContext, workspaceId: string): boolean {
  const role = workspaceRole(ctx, workspaceId);
  return role ? isWorkspaceWide(role) : false;
}

export function scopedClientIds(ctx: AuthContext): string[] {
  return ctx.clientMemberships.map((m) => m.clientId);
}

export function canMutate(ctx: AuthContext, workspaceId: string): boolean {
  const role = workspaceRole(ctx, workspaceId);
  return role === "owner" || role === "operator";
}
