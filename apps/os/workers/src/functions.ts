import { eq } from "drizzle-orm";
import { EVENTS, inngest } from "@tharros/shared/inngest";
import { getDb } from "@tharros/shared/db";
import { runAdAccountSync } from "@tharros/shared/sync";
import { writeInngestAudit } from "@tharros/shared/worker-audit";
import { authorizations, workspaces } from "@tharros/shared/schema";

/**
 * Shared OS orchestration. Kill-switch + authorize stubs.
 * No Meta/Google mutate. Platform sync lives in jobs/meta/ads and jobs/google/ads.
 */

export const stubPing = inngest.createFunction(
  { id: "os-stub-ping", name: "OS stub ping", triggers: [{ event: EVENTS.stubPing }] },
  async ({ event, step }: any) => {
    await step.run("complete-stub", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "jobs.stub_complete",
        payload: {
          event: EVENTS.stubPing,
          note: event.data.note,
          clientId: event.data.clientId,
          stub: true,
          platforms: "none",
        },
      });
    });
    return { ok: true, stub: true, processedAt: new Date().toISOString() };
  },
);

export const stubSync = inngest.createFunction(
  { id: "os-stub-sync", name: "OS legacy stub sync", triggers: [{ event: EVENTS.stubSync }] },
  async ({ event, step }: any) => {
    if (event.data.adAccountId) {
      return step.run("delegate-m2-sync", async () => runAdAccountSync(event.data.adAccountId as string));
    }
    await step.run("complete-stub", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "jobs.stub_complete",
        payload: {
          event: EVENTS.stubSync,
          clientId: event.data.clientId,
          note: "No ad account id — nothing to pull.",
        },
      });
    });
    return { ok: true, stub: true, processedAt: new Date().toISOString() };
  },
);

export const applyRequested = inngest.createFunction(
  { id: "os-apply-requested", name: "OS apply requested", triggers: [{ event: EVENTS.applyRequested }] },
  async ({ event, step }: any) => {
    const gate = await step.run("authorize-and-kill-switch", async () => {
      const db = getDb();
      const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, event.data.workspaceId),
      });
      if (!workspace) return { blocked: "workspace_not_found" as const };
      if (workspace.applyKillSwitch) return { blocked: "apply_kill_switch" as const };

      const authz = await db.query.authorizations.findFirst({
        where: eq(authorizations.id, event.data.authorizationId),
      });
      if (!authz || authz.workspaceId !== event.data.workspaceId) {
        return { blocked: "authorization_required" as const };
      }
      if (authz.revokedAt) return { blocked: "authorization_revoked" as const };
      return { blocked: "apply_not_implemented" as const };
    });

    await step.run("audit-block", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "jobs.apply_blocked",
        payload: {
          event: EVENTS.applyRequested,
          clientId: event.data.clientId,
          authorizationId: event.data.authorizationId,
          ...gate,
          note: "Authorize-to-apply is enforced. No Meta/Google writes. No Zapier.",
        },
      });
    });

    return {
      ok: false,
      stub: true,
      ...gate,
      note: "Apply execution is out of scope. Kill switch and authorization are required.",
    };
  },
);

export const osFunctions = [stubPing, stubSync, applyRequested];
export const OS_FUNCTION_IDS = ["os-stub-ping", "os-stub-sync", "os-apply-requested"] as const;
