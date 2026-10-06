import { SEO_EVENTS, SEO_FUNCTION_IDS } from "@cerevex/contracts";
import { importProfiles, runSeoResearchJob } from "@cerevex/skills";
import { persistSkillJobRun, skillJobSummary } from "@tharros/ads-shared/skill-jobs";
import { inngest } from "../client";

export const skillResearchFn = inngest.createFunction(
  { id: SEO_FUNCTION_IDS.skillResearch, triggers: [{ event: SEO_EVENTS.skillResearchRequested }] },
  async ({ event }: { event: { data?: { workspaceId?: string; clientId?: string; keyword?: string } } }) => {
    const hvac = importProfiles().clients.find((client) => client.slug === "hvac-usa");
    if (!hvac) return { skipped: "missing_profile" };
    const run = runSeoResearchJob(hvac, { keyword: event.data?.keyword });
    const data = event.data ?? {};
    if (data.workspaceId && data.clientId) {
      await persistSkillJobRun({ workspaceId: data.workspaceId, clientId: data.clientId, run });
    }
    return skillJobSummary(run);
  },
);