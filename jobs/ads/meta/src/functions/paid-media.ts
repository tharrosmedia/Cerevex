import { ADS_EVENTS, ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { importProfiles, runPaidMediaJob } from "@cerevex/skills";
import { inngest } from "@tharros/ads-shared/inngest";
import { persistSkillJobRun, skillJobSummary } from "@tharros/ads-shared/skill-jobs";

export const paidMediaMeta = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.paidMediaMeta, triggers: [{ event: ADS_EVENTS.paidMediaMeta }] },
  async ({ event }: { event: { data?: { workspaceId?: string; clientId?: string } } }) => {
    const hvac = importProfiles().clients.find((client) => client.slug === "hvac-usa");
    if (!hvac) return { skipped: "missing_profile" };
    const run = runPaidMediaJob(hvac, "meta");
    const data = event.data ?? {};
    if (data.workspaceId && data.clientId) {
      await persistSkillJobRun({ workspaceId: data.workspaceId, clientId: data.clientId, run });
    }
    return skillJobSummary(run);
  },
);
