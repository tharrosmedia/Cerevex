/**
 * Read the skill-record block stored on recommendation evidence.
 * Kept free of Node and `@cerevex/skills` so the cockpit bundle can import it.
 * The key matches `SKILL_REC_KEY` in `@cerevex/skills`.
 */

export const SKILL_REC_EVIDENCE_KEY = "skillRec";

export interface SkillRecView {
  group: "do_now" | "test" | "needs_data";
  source: string;
  sources: string[];
  versions: { skill: string; pack: string; layer: string };
  approveHidden: boolean;
  approveHiddenReason: string | null;
  channel: string | null;
  skill: string | null;
  claimsCheck: string | null;
  dedupeKey: string | null;
  target: string | null;
}

const GROUPS = new Set(["do_now", "test", "needs_data"]);

export function readSkillRec(evidence: unknown): SkillRecView | null {
  if (!isRecord(evidence)) return null;
  const raw = evidence[SKILL_REC_EVIDENCE_KEY];
  if (!isRecord(raw)) return null;
  if (typeof raw.group !== "string" || !GROUPS.has(raw.group)) return null;
  const versions = isRecord(raw.versions) ? raw.versions : {};
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((item): item is string => typeof item === "string") : [];
  const source = typeof raw.source === "string" ? raw.source : sources[0] ?? "";
  if (source.length === 0) return null;
  return {
    group: raw.group as SkillRecView["group"],
    source,
    sources: sources.length > 0 ? sources : [source],
    versions: {
      skill: typeof versions.skill === "string" ? versions.skill : "unknown",
      pack: typeof versions.pack === "string" ? versions.pack : "unknown",
      layer: typeof versions.layer === "string" ? versions.layer : "unknown",
    },
    approveHidden: raw.approveHidden === true,
    approveHiddenReason: typeof raw.approveHiddenReason === "string" ? raw.approveHiddenReason : null,
    channel: typeof raw.channel === "string" ? raw.channel : null,
    skill: typeof raw.skill === "string" ? raw.skill : null,
    claimsCheck: typeof raw.claimsCheck === "string" ? raw.claimsCheck : null,
    dedupeKey: typeof raw.dedupeKey === "string" ? raw.dedupeKey : null,
    target: typeof raw.target === "string" ? raw.target : null,
  };
}

export const SKILL_GROUP_LABEL = {
  do_now: "Do now",
  test: "Test",
  needs_data: "Needs data",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
