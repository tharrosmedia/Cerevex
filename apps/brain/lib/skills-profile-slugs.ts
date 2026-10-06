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
