/**
 * Seed a client prompt layer from profile facts. Seeding is not learning.
 * Slice 1 seeds HVAC USA only. Every rule cites the profile field it came from.
 */

import type { ClientSkillConfig, Fact } from "./types";

export const HVAC_USA_LAYER_VERSION = "hvac-usa@v1";

export interface SeededRule {
  text: string;
  cites: string;
}

export interface SeededPromptLayer {
  version: string;
  clientSlug: string;
  profileHash: string;
  profileUpdatedAt: string;
  rules: SeededRule[];
  markdown: string;
}

export function seedPromptLayer(client: ClientSkillConfig): SeededPromptLayer | null {
  if (client.slug !== "hvac-usa" || !client.promptLayer.seeded || !client.promptLayer.version) return null;
  const rules: SeededRule[] = [];
  const outcome = known(client.qualifiedOutcome);
  if (outcome) rules.push({ text: `Qualified outcome is ${outcome}.`, cites: "qualified_outcome" });
  const brands = known(client.brands);
  if (brands) rules.push({ text: brands, cites: "brands" });
  const voice = known(client.voice);
  if (voice) rules.push({ text: voice, cites: "voice" });
  const protectedLines = known(client.protectedLines);
  if (protectedLines) rules.push({ text: `Keep protected lines exactly. ${protectedLines}`, cites: "protectedLines" });
  const neverSay = known(client.neverSay);
  if (neverSay) rules.push({ text: `Never say: ${neverSay}`, cites: "neverSay" });
  const packLine = client.packs.map((pack) => `${pack.id} (${pack.role})`).join("; ");
  if (packLine) rules.push({ text: `Compliance packs: ${packLine}. A layer cannot loosen them.`, cites: "packs" });
  for (const note of client.stores[0]?.notes ?? []) {
    if (note.state === "known" && note.value) rules.push({ text: note.value, cites: "store.notes" });
  }
  if (client.dealerAuthorization?.state === "tbd") {
    rules.push({
      text: "Dealer tier and MAP documents are TBD. Do not invent a price, a dealer claim, or a MAP exception.",
      cites: "dealerAuthorization",
    });
  }
  const lines = [
    `# ${client.displayName} prompt layer`,
    "",
    `> version ${client.promptLayer.version}`,
    `> seeded from profile ${client.profileHash} (${client.profileUpdatedAt})`,
    "> Seeded from the profile. This is not a learned rule.",
    "> Exported from Cerevex. Read-only. Change it through a Cerevex rec.",
    "",
    "## Rules",
    "",
    ...rules.map((rule) => `- ${rule.text} _(cites ${rule.cites})_`),
    "",
  ];
  return {
    version: client.promptLayer.version,
    clientSlug: client.slug,
    profileHash: client.profileHash,
    profileUpdatedAt: client.profileUpdatedAt,
    rules,
    markdown: lines.join("\n"),
  };
}

function known(fact: Fact<string> | null | undefined): string | null {
  if (!fact || fact.state !== "known" || !fact.value?.trim()) return null;
  return fact.value.trim();
}
