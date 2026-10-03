/**
 * Profile slug → os.clients.name values that link that slug.
 * First existing row wins. Matching is exact against this list, not against the profile display name.
 *
 * The seed (`apps/ads/shared/src/seed.ts`) names the Kansas City pilot "KC Prestige".
 * The profile display name is "KC Prestige HVAC". Either row links `kc-prestige-hvac`.
 */
export const SKILL_CLIENT_ALIASES: Record<string, readonly string[]> = {
  "hvac-usa": ["HVAC USA"],
  "got-ductless": ["Got Ductless"],
  "kc-prestige-hvac": ["KC Prestige HVAC", "KC Prestige"],
  "elmar-hvac": ["Elmar HVAC"],
  "tharros-media": ["Tharros Media", "Tharros Media (agency brand)"],
  cerevex: ["Cerevex"],
};
