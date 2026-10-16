/** Owner-facing MCP connector label. The slug used in tokens and logs is allocated separately. */
export const MCP_DISPLAY_NAME_MAX = 64;

export const MCP_DISPLAY_NAME_MESSAGE =
  "Display name must be 1 to 64 characters after trimming and must not contain control characters.";

const CONTROL = /\p{Cc}/u;
const SLUG = /^[a-z0-9-]{2,40}$/;

/** Trimmed display name, or null when it is empty, too long, or contains a control character. */
export function parseMcpDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  const length = [...name].length;
  if (length < 1 || length > MCP_DISPLAY_NAME_MAX) return null;
  if (CONTROL.test(name)) return null;
  return name;
}

function slugBase(displayName: string): string {
  const folded = displayName
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clipped = folded.slice(0, 40).replace(/-+$/g, "");
  if (SLUG.test(clipped) && /[a-z0-9]/.test(clipped)) return clipped;
  return "agent";
}

/**
 * Immutable slug for token verify and logs. A display name that is already a
 * slug is kept. Anything else is folded to the slug alphabet, then a numeric
 * suffix avoids a slug this workspace already uses.
 */
export function allocateMcpIdentitySlug(displayName: string, taken: ReadonlySet<string>): string | null {
  const base = slugBase(displayName);
  for (let n = 1; n <= 1000; n += 1) {
    const suffix = n === 1 ? "" : `-${n}`;
    const room = 40 - suffix.length;
    let stem = base.slice(0, room).replace(/-+$/g, "");
    if (stem.length < 2 || !/[a-z0-9]/.test(stem)) stem = "agent";
    const candidate = `${stem}${suffix}`;
    if (SLUG.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return null;
}
