/**
 * Persist a native skill run: cockpit recs plus one AI spend row.
 * Spend is observable. There is no cap and no cutoff.
 */
import type { AccountReviewRun, SkillJobRun } from "@cerevex/skills";
import { inArray } from "drizzle-orm";
import { getDb } from "./db";
import { recordRecLifecycle } from "./rec-lifecycle";
import { clients } from "./schema";
import { SKILL_CLIENT_ALIASES } from "./skill-client-aliases";
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

/** Existing os.clients rows for a profile slug. Does not create a tenant. */
export async function findLinkedSkillClients(slug: string): Promise<{ workspaceId: string; clientId: string }[]> {
  const names = SKILL_CLIENT_ALIASES[slug];
  if (!names?.length) return [];
  const rows = await getDb()
    .select({ id: clients.id, workspaceId: clients.workspaceId })
    .from(clients)
    .where(inArray(clients.name, [...names]));
  return rows.map((row) => ({ workspaceId: row.workspaceId, clientId: row.id }));
}

export async function persistAccountReview(input: {
  workspaceId: string;
  clientId: string;
  review: AccountReviewRun;
}): Promise<{ stored: StoredSkillRec[]; runId: string }> {
  const accepts = input.review.runs.flatMap((run) => run.ingest.accepted);
  const stored = await storeIngestedSkillRecs({
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    accepts,
    actorType: "worker",
  });
  const storeId = accepts[0]?.prepared.storeId ?? null;
  const spends = [
    {
      module: "account-review-loop",
      spend: input.review.spend,
      resolved: input.review.resolved,
      notChecked: input.review.packet.notChecked.map((line) => line.loop),
    },
    ...input.review.runs.map((run) => ({
      module: run.platform ? `${run.job}:${run.platform}` : run.job,
      spend: run.spend,
      resolved: run.resolved,
      notChecked: run.notChecked,
    })),
  ];
  for (const row of spends) {
    await recordRecLifecycle({
      kind: "ai_spend",
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      storeId,
      module: row.module,
      actorType: "worker",
      entityType: "skill_run",
      runId: row.spend.runId,
      modelId: row.spend.modelId,
      usd: row.spend.usd,
      payload: {
        promptHash: row.spend.promptHash,
        templateVersion: row.resolved.templateVersion,
        packVersion: row.resolved.packVersion,
        layerVersion: row.resolved.layerVersion,
        resolvedPrompt: row.resolved.text,
        modelCall: row.spend.modelCall,
        inputTokens: row.spend.inputTokens,
        outputTokens: row.spend.outputTokens,
        notChecked: row.notChecked,
      },
    });
  }
  await recordRecLifecycle({
    kind: "account_review",
    workspaceId: input.workspaceId,
    clientId: input.clientId,
    storeId,
    module: "account-review-loop",
    actorType: "worker",
    entityType: "skill_run",
    runId: input.review.spend.runId,
    payload: { ...input.review.packet },
  });
  return { stored, runId: input.review.spend.runId };
}

export function accountReviewSummary(review: AccountReviewRun) {
  return {
    job: "account-review-loop" as const,
    modelId: review.packet.modelId,
    promptHash: review.packet.promptHash,
    weekOf: review.packet.weekOf,
    usd: review.spend.usd,
    capped: review.spend.capped,
    nothingToActOn: review.packet.nothingToActOn,
    note: review.packet.note,
    counts: review.packet.counts,
    checked: review.packet.checked.map((line) => line.loop),
    notChecked: review.packet.notChecked.map((line) => line.loop),
    sourcesNotChecked: review.packet.sourcesNotChecked,
    topApprovals: review.packet.topApprovals.length,
  };
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
