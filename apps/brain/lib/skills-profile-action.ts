"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "@/src/lib/db/stores";
import { AUTH_COOKIE_NAME } from "./auth-cookie";
import { runSkillsProfileLoad } from "./skills-profile-load";
import { authorizeApproveSession } from "./sensitive-auth";

function skillsReturn(kind: "loaded" | "error", message: string) {
  return `/stores?skills=${kind}&msg=${encodeURIComponent(message)}`;
}

export async function loadSkillsProfileAction(formData: FormData) {
  const jar = await cookies();
  const creds = {
    cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null,
    internalKey: null,
  };
  const gate = authorizeApproveSession(creds);
  if (!gate.ok) redirect(skillsReturn("error", gate.error));

  const store = await getStore(String(formData.get("storeId") || ""));
  if (!store) redirect(skillsReturn("error", "That store no longer exists."));

  const result = await runSkillsProfileLoad({
    creds,
    siteId: String(store.id),
    slug: String(formData.get("slug") || ""),
  });
  if (!result.ok) redirect(skillsReturn("error", result.message));
  revalidatePath("/stores");
  redirect(skillsReturn("loaded", `Skills profile loaded. Snapshot ${result.snapshotId}.`));
}
