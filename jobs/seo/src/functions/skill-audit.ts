import { SEO_EVENTS, SEO_FUNCTION_IDS } from "@cerevex/contracts";
import { importProfiles, runSeoAuditJob } from "@cerevex/skills";
import { persistSkillJobRun, skillJobSummary } from "@tharros/ads-shared/skill-jobs";
import { inngest } from "../client";

export const skillAuditFn = inngest.createFunction(
  { id: SEO_FUNCTION_IDS.skillAudit, triggers: [{ event: SEO_EVENTS.skillAuditRequested }] },
  async ({ event }: { event: { data?: { workspaceId?: string; clientId?: string; gscRowCount?: number } } }) => {
    const hvac = importProfiles().clients.find((client) => client.slug === "hvac-usa");
    if (!hvac) return { skipped: "missing_profile" };
    const run = runSeoAuditJob(hvac, { gscRowCount: event.data?.gscRowCount });
    const data = event.data ?? {};
    if (data.workspaceId && data.clientId) {
      await persistSkillJobRun({ workspaceId: data.workspaceId, clientId: data.clientId, run });
    }
    return skillJobSummary(run);
  },
);
