/**
 * Resolved prompt for a native run: template@version + client layer@version.
 * The model id is pinned per job. There is no AI cost cap.
 */

import { createHash } from "node:crypto";
import { loadTemplate, readCommittedManifest } from "./loader";
import { seedPromptLayer } from "./prompt-seed";
import type { ClientSkillConfig, SkillSlug } from "./types";

/** Pinned model id. Jobs do not read XAI_MODEL, so a deploy cannot swap the model quietly. */
export const SKILL_MODEL_PINS: Record<"paid-media" | "seo-audit" | "seo-research" | "account-review-loop", string> = {
  "paid-media": "grok-4.6",
  "seo-audit": "grok-4.6",
  "seo-research": "grok-4.6",
  "account-review-loop": "grok-4.6",
};

export interface ResolvedPrompt {
  skill: SkillSlug;
  templateVersion: string;
  packVersion: string;
  layerVersion: string;
  modelId: string;
  /** template pin + layer text. Not a second copy of the whole skill body. */
  text: string;
  promptHash: string;
}

export interface AiSpendLog {
  runId: string;
  clientSlug: string;
  job: string;
  modelId: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  promptHash: string;
  templateVersion: string;
  packVersion: string;
  layerVersion: string;
  /** Adam's call: usage is unlimited. This is never a cutoff. */
  capped: false;
  modelCall: "not_made";
}

export function resolveSkillPrompt(client: ClientSkillConfig, skill: keyof typeof SKILL_MODEL_PINS): ResolvedPrompt {
  const version = pinnedVersion(skill);
  const template = loadTemplate(skill, version);
  const layer = seedPromptLayer(client);
  const primary = client.packs.find((pack) => pack.role === "primary") ?? client.packs[0];
  const packVersion = primary ? `${primary.id}@${primary.version}` : "unknown";
  const layerVersion = layer?.version ?? "none";
  const text = [
    `template: ${skill}@${version}`,
    `templateHash: ${template.contentHash}`,
    `pack: ${packVersion}`,
    `layer: ${layerVersion}`,
    `model: ${SKILL_MODEL_PINS[skill]}`,
    "",
    layer?.markdown ?? "No client layer. Run on the profile and the template.",
  ].join("\n");
  return {
    skill,
    templateVersion: `${skill}@${version}`,
    packVersion,
    layerVersion,
    modelId: SKILL_MODEL_PINS[skill],
    text,
    promptHash: createHash("sha256").update(text).digest("hex"),
  };
}

export function deterministicSpend(clientSlug: string, job: string, resolved: ResolvedPrompt, runId: string): AiSpendLog {
  return {
    runId,
    clientSlug,
    job,
    modelId: resolved.modelId,
    usd: 0,
    inputTokens: 0,
    outputTokens: 0,
    promptHash: resolved.promptHash,
    templateVersion: resolved.templateVersion,
    packVersion: resolved.packVersion,
    layerVersion: resolved.layerVersion,
    capped: false,
    modelCall: "not_made",
  };
}

function pinnedVersion(skill: string): string {
  const entry = readCommittedManifest().entries.find((item) => item.slug === skill);
  if (!entry) throw new Error(`${skill} is not in the skills manifest`);
  return entry.version;
}
