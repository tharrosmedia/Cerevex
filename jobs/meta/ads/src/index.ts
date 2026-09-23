import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { inngest } from "@tharros/ads-shared/inngest";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Legacy Meta ads Inngest listener (R5 dual-compat).
 * Canonical emit + consume is ads/account.sync with platform in the payload.
 * This function stays registered on meta-ads-account-sync / meta/ads/account.sync
 * for one release so in-flight jobs finish. Remove after that release.
 */
export const metaAdsAccountSync = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync,
    name: "Meta ads account sync (legacy meta/ads/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.metaAdsAccountSync }],
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
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync] as const;
