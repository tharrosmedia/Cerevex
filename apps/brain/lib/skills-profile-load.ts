import type { AdsClient } from "./ads-bff";
import { adsApi } from "./ads-bff";
import { authorizeApproveSession, type CredentialSource } from "./sensitive-auth";

export function clientForSite(
  rows: ReadonlyArray<Pick<AdsClient, "id" | "siteId">>,
  siteId: string,
): { ok: true; clientId: string } | { ok: false; message: string } {
  const matches = rows.filter((row) => row.siteId === siteId);
  if (matches.length === 1 && matches[0]) return { ok: true, clientId: matches[0].id };
  if (matches.length === 0) return { ok: false, message: "This store is not linked to an ads client." };
  return { ok: false, message: "More than one ads client is linked to this store." };
}

export function skillsProfilePost(clientId: string, slug: string) {
  return {
    path: `/clients/${clientId}/skills-profile`,
    method: "POST" as const,
    body: { slug },
    asOwner: true as const,
  };
}

export type SkillsProfileLoadResult =
  | { ok: true; snapshotId: string; clientId: string }
  | { ok: false; message: string };

export async function loadLinkedSkillsProfile(input: {
  siteId: string;
  slug: string;
}): Promise<SkillsProfileLoadResult> {
  const listed = await adsApi<{ clients: AdsClient[] }>("/clients", {}, { asOwner: true });
  if (!listed.ok) return { ok: false, message: listed.message };
  const match = clientForSite(listed.data.clients, input.siteId);
  if (!match.ok) return match;
  const post = skillsProfilePost(match.clientId, input.slug);
  const posted = await adsApi<{ snapshotId: string; clientId: string }>(
    post.path,
    { method: post.method, body: JSON.stringify(post.body) },
    { asOwner: post.asOwner },
  );
  if (!posted.ok) return { ok: false, message: posted.message };
  return {
    ok: true,
    snapshotId: posted.data.snapshotId,
    clientId: posted.data.clientId,
  };
}

/**
 * Brain owner gate. authorizeApproveSession is the approve-owner console
 * session. A console operator who is not on that allowlist, the service key,
 * and an anonymous caller do not load a profile.
 */
export async function runSkillsProfileLoad(input: {
  creds: CredentialSource;
  siteId: string;
  slug: string;
  load?: (loadInput: { siteId: string; slug: string }) => Promise<SkillsProfileLoadResult>;
}): Promise<{ ok: true; snapshotId: string } | { ok: false; status: number; message: string }> {
  const gate = authorizeApproveSession(input.creds);
  if (!gate.ok) return { ok: false, status: gate.status, message: gate.error };
  const slug = input.slug.trim();
  if (!slug) return { ok: false, status: 400, message: "Choose a skills profile." };
  const loaded = await (input.load ?? loadLinkedSkillsProfile)({ siteId: input.siteId, slug });
  if (!loaded.ok) return { ok: false, status: 400, message: loaded.message };
  return { ok: true, snapshotId: loaded.snapshotId };
}
