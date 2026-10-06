import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { importProfiles } from "@cerevex/skills";
import { workspaceRole } from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";
import { SkillProfileLinkError, linkSkillProfile } from "@tharros/ads-shared/skill-profile-link";
import { auditActor, isServicePrincipal } from "./auth";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const bodySchema = z.object({
  slug: z.string().trim().min(1).max(80),
});

const OWNER_ONLY = "Only a workspace owner can load a skills profile.";

/**
 * Owner-only profile load. Brain's Stores row calls this with the owner
 * token after authorizeApproveSession. The service key and an operator
 * membership are refused and write nothing.
 */
export function registerSkillsProfileRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.post("/clients/:id/skills-profile", requireAuth, async (c) => {
    const auth = c.get("auth");
    const client = await getVisibleClient(auth, c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    if (isServicePrincipal(auth) || !auth.user || workspaceRole(auth, client.workspaceId) !== "owner") {
      throw new HTTPException(403, { message: OWNER_ONLY });
    }
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Skills profile slug is required." });
    const actor = auditActor(auth);
    try {
      const linked = await linkSkillProfile(getDb(), importProfiles(), {
        slug: parsed.data.slug,
        clientId: client.id,
        siteId: client.siteId,
        approvalOwnerUserId: auth.user.id,
        audit: {
          workspaceId: client.workspaceId,
          actorType: actor.actorType,
          actorId: actor.actorId,
        },
      });
      return c.json(linked);
    } catch (error) {
      if (error instanceof SkillProfileLinkError) {
        const status = error.code === "already_linked" ? 409 : 400;
        throw new HTTPException(status, { message: error.message });
      }
      throw error;
    }
  });
}
