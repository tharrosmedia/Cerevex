import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { inngest } from "@tharros/ads-shared/inngest";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Legacy Google ads Inngest listener (R5 dual-compat).
 * Canonical emit + consume is ads/account.sync with platform in the payload.
 * This function stays registered on google-ads-account-sync / google/ads/account.sync
 * for one release so in-flight jobs finish. Remove after that release.
 */
export const googleAdsAccountSync = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync,
    name: "Google ads account sync (legacy google/ads/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.googleAdsAccountSync }],
  },
  async ({ event, step }: any) => {
    const result = await step.run("pull-entities", async () => runAdAccountSync(event.data.adAccountId));
    await step.run("audit", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: result.status === "error" ? "jobs.sync_failed" : "jobs.sync_complete",
        payload: {
          event: event.name,
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
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync] as const;
