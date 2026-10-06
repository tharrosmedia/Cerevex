import { ADS_EVENTS, ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { ACCOUNT_REVIEW_CRON, importProfiles, runAccountReview } from "@cerevex/skills";
import { inngest } from "@tharros/ads-shared/inngest";
import { accountReviewSummary, findLinkedSkillClients, persistAccountReview } from "@tharros/ads-shared/skill-jobs";

/**
 * Weekly HVAC USA packet. Paid review and SEO run. Other loops stay "not checked".
 * A missing HVAC USA client row is left missing. This function does not create one.
 */
export const accountReview = inngest.createFunction(
  {
    id: ADS_FUNCTION_IDS.accountReview,
    name: "Weekly account review",
    triggers: [{ event: ADS_EVENTS.accountReviewRequested }, { cron: ACCOUNT_REVIEW_CRON }],
  },
  async ({
    event,
  }: {
    event: { data?: { workspaceId?: string; clientId?: string; gscRowCount?: number; keyword?: string } };
  }) => {
    const hvac = importProfiles().clients.find((client) => client.slug === "hvac-usa");
    if (!hvac) return { skipped: "missing_profile" };
    const data = event.data ?? {};
    const review = runAccountReview(hvac, { gscRowCount: data.gscRowCount, keyword: data.keyword });
    const targets =
      data.workspaceId && data.clientId
        ? [{ workspaceId: data.workspaceId, clientId: data.clientId }]
        : await findLinkedSkillClients("hvac-usa");
    if (targets.length === 0) return { ...accountReviewSummary(review), persisted: false };
    for (const target of targets) {
      await persistAccountReview({ workspaceId: target.workspaceId, clientId: target.clientId, review });
    }
    return { ...accountReviewSummary(review), persisted: true, clients: targets.length };
  },
);
