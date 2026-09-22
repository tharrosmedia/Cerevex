import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Google ads Inngest functions. Prefix: google/ads/*
 * Read / mock sync only. No live Google Ads mutate.
 */
export const googleAdsAccountSync = inngest.createFunction(
  { id: "google-ads-account-sync", name: "Google ads account sync", triggers: [{ event: EVENTS.googleAdsAccountSync }] },
  async ({ event, step }: any) => {
    const result = await step.run("pull-entities", async () => runAdAccountSync(event.data.adAccountId));
    await step.run("audit", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: result.status === "error" ? "jobs.sync_failed" : "jobs.sync_complete",
        payload: {
          event: EVENTS.googleAdsAccountSync,
          clientId: event.data.clientId,
          adAccountId: event.data.adAccountId,
          platform: "google",
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

export const functions = [googleAdsAccountSync];
export const FUNCTION_IDS = ["google-ads-account-sync"] as const;
