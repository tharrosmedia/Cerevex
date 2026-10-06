import type { MiddlewareHandler } from "hono";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { canMutate, skillSlugForClientName } from "@tharros/ads-shared";
import { ingestRecommendationYaml } from "@cerevex/skills";
import { loadRecentSkillRecs, storeIngestedSkillRecs } from "@tharros/ads-shared/skill-ingest";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const bodySchema = z.object({
  yaml: z.string().min(1).max(200_000),
});

export function registerSkillIngestRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.post("/clients/:id/recommendations/ingest", requireAuth, async (c) => {
    const auth = c.get("auth");
    const client = await getVisibleClient(auth, c.req.param("id"));
    if (!client) throw new HTTPException(404, { message: "Client not found" });
    if (!canMutate(auth, client.workspaceId)) {
      throw new HTTPException(403, { message: "You cannot add recommendations for this client." });
    }
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "YAML document is required" });
    const clientSlug = skillSlugForClientName(client.name);
    if (!clientSlug) {
      throw new HTTPException(400, { message: "This client is not an in-scope skill tenant." });
    }
    const now = new Date();
    const existing = await loadRecentSkillRecs(client.id, now);
    const ingested = ingestRecommendationYaml(parsed.data.yaml, { clientSlug, now, existing });
    const stored =
      ingested.accepted.length === 0
        ? []
        : await storeIngestedSkillRecs({
            workspaceId: client.workspaceId,
            clientId: client.id,
            accepts: ingested.accepted,
            actorType: auth.user ? "user" : "service",
            actorId: auth.user?.id ?? null,
          });
    return c.json({
      accepted: stored,
      rejected: ingested.rejected,
    });
  });
}
