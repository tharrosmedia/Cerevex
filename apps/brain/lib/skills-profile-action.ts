"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "@/src/lib/db/stores";
import { AUTH_COOKIE_NAME } from "./auth-cookie";
import { runSkillsProfileLoad } from "./skills-profile-load";
import { safeSetupReturn } from "./client-setup-checklist";
import { authorizeApproveSession } from "./sensitive-auth";

function skillsReturn(kind: "loaded" | "error", message: string, returnTo: string | null) {
  if (returnTo) return `${returnTo}?skills=${kind}&msg=${encodeURIComponent(message)}`;
  return `/stores?skills=${kind}&msg=${encodeURIComponent(message)}`;
}

export async function loadSkillsProfileAction(formData: FormData) {
  const returnTo = safeSetupReturn(String(formData.get("returnTo") || ""));
  const jar = await cookies();
  const creds = {
    cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null,
    internalKey: null,
  };
  const gate = authorizeApproveSession(creds);
  if (!gate.ok) redirect(skillsReturn("error", gate.error, returnTo));

  const store = await getStore(String(formData.get("storeId") || ""));
  if (!store) redirect(skillsReturn("error", "That store no longer exists.", null));

  const result = await runSkillsProfileLoad({
    creds,
    siteId: String(store.id),
    slug: String(formData.get("slug") || ""),
  });
  if (!result.ok) redirect(skillsReturn("error", result.message, returnTo));
  revalidatePath("/stores");
  if (returnTo) revalidatePath(returnTo);
  const loaded = returnTo ? "Skills profile loaded." : `Skills profile loaded. Snapshot ${result.snapshotId}.`;
  redirect(skillsReturn("loaded", loaded, returnTo));
}
