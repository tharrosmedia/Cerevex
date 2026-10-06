/**
 * Persist a native skill run: cockpit recs plus one AI spend row.
 * Spend is observable. There is no cap and no cutoff.
 */
import type { SkillJobRun } from "@cerevex/skills";
import { recordRecLifecycle } from "./rec-lifecycle";
import { storeIngestedSkillRecs, type StoredSkillRec } from "./skill-ingest";

export async function persistSkillJobRun(input: {
  workspaceId: string;
  clientId: string;
  run: SkillJobRun;
}): Promise<{ stored: StoredSkillRec[]; runId: string; modelId: string; usd: number }> {
  const stored = await storeIngestedSkillRecs({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    accepts: input.run.ingest.accepted,
    actorType: "worker",
  });
  await recordRecLifecycle({
    kind: "ai_spend",
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    storeId: input.run.ingest.accepted[0]?.prepared.storeId ?? null,
    module: input.run.job,
    actorType: "worker",
    entityType: "skill_run",
    runId: input.run.spend.runId,
    modelId: input.run.spend.modelId,
    usd: input.run.spend.usd,
    payload: {
      promptHash: input.run.spend.promptHash,
      templateVersion: input.run.resolved.templateVersion,
      packVersion: input.run.resolved.packVersion,
      layerVersion: input.run.resolved.layerVersion,
      resolvedPrompt: input.run.resolved.text,
      modelCall: input.run.spend.modelCall,
      inputTokens: input.run.spend.inputTokens,
      outputTokens: input.run.spend.outputTokens,
      notChecked: input.run.notChecked,
    },
  });
  return { stored, runId: input.run.spend.runId, modelId: input.run.spend.modelId, usd: input.run.spend.usd };
}

export function skillJobSummary(run: SkillJobRun) {
  return {
    job: run.job,
    platform: run.platform,
    modelId: run.resolved.modelId,
    promptHash: run.resolved.promptHash,
    templateVersion: run.resolved.templateVersion,
    packVersion: run.resolved.packVersion,
    layerVersion: run.resolved.layerVersion,
    usd: run.spend.usd,
    capped: run.spend.capped,
    accepted: run.ingest.accepted.length,
    rejected: run.ingest.rejected.length,
    notChecked: run.notChecked,
  };
}
