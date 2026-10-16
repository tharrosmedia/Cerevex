import { skillProfileSlugForName } from "./ui-copy";

/** In-scope profile slugs. Same set as the os.skill_client_configs slug check. */
export const SKILL_PROFILE_SLUGS = [
  "hvac-usa",
  "got-ductless",
  "kc-prestige-hvac",
  "elmar-hvac",
  "tharros-media",
  "cerevex",
] as const;

export type SkillProfileSlug = (typeof SKILL_PROFILE_SLUGS)[number];

const SKILL_PROFILE_SLUG_SET = new Set<string>(SKILL_PROFILE_SLUGS);

/** Select default for a store. Empty when the name is not a known profile. */
export function defaultSkillProfileSlug(storeName: string): string {
  const slug = skillProfileSlugForName(storeName.trim());
  if (slug && SKILL_PROFILE_SLUG_SET.has(slug)) return slug;
  return "";
}
