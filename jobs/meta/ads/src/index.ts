import { EVENTS, inngest } from "@tharros/shared/inngest";
import { runAdAccountSync } from "@tharros/shared/sync";
import { writeInngestAudit } from "@tharros/shared/worker-audit";

/**
 * Meta ads Inngest functions. Prefix: meta/ads/*
 * Read / mock sync only. No live Meta mutate.
 */
export const metaAdsAccountSync = inngest.createFunction(
  { id: "meta-ads-account-sync", name: "Meta ads account sync", triggers: [{ event: EVENTS.metaAdsAccountSync }] },
  async ({ event, step }: any) => {
    const result = await step.run("pull-entities", async () => runAdAccountSync(event.data.adAccountId));
    await step.run("audit", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: result.status === "error" ? "jobs.sync_failed" : "jobs.sync_complete",
        payload: {
          event: EVENTS.metaAdsAccountSync,
          clientId: event.data.clientId,
          adAccountId: event.data.adAccountId,
          platform: "meta",
          mode: result.mode,
          entityCount: result.entityCount,
          lastError: result.lastError,
          writes: false,
        },
      });
    });
    return result;
  },
);

export const functions = [metaAdsAccountSync];
export const FUNCTION_IDS = ["meta-ads-account-sync"] as const;
