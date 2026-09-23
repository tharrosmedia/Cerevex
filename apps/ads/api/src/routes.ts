import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Platform } from "@tharros/ads-shared";
import {
  GOOGLE_SCOPES,
  META_SCOPES,
  authorizeUrl,
  isGoogleConfigured,
  isMetaConfigured,
  oauthConfig,
  webOrigin,
} from "@tharros/ads-shared/oauth";
import { loadTokens } from "@tharros/ads-shared/credentials";
import { getDb } from "@tharros/ads-shared/db";
import { sendAdAccountSync } from "@tharros/ads-shared/inngest";
import { adAccounts, clients } from "@tharros/ads-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  enqueueAccountSync,
  listEntities,
  listPublicAdAccounts,
  requireMutableClient,
  requireVisibleAccount,
  toPublicAccount,
  disconnectAccount,
  setAccountFrozen,
  upsertConnectedAccount,
} from "./connect";
import { childLogger } from "./logger";
import { exchangeCode } from "./oauth-exchange";
import { signOAuthState, verifyOAuthState } from "./oauth-state";
import { requireWritableCapability } from "./capabilities";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const platformSchema = z.enum(["meta", "google"]);
const mockConnectSchema = z.object({
  clientId: z.string().uuid(),
  platform: platformSchema,
});

function configured(platform: Platform): boolean {
  return platform === "meta" ? isMetaConfigured() : isGoogleConfigured();
}

function consoleOrigin(): string {
  return (process.env.CONSOLE_ORIGIN ?? process.env.NEXT_PUBLIC_CONSOLE_ORIGIN ?? "").replace(/\/$/, "");
}

function postConnectDest(): URL {
  const origin = consoleOrigin();
  if (origin) return new URL("/ads", origin);
  return new URL(`${webOrigin()}/app`);
}

export function registerConnectRoutes(app: Hono<AppEnv>, requireAuth: MiddlewareHandler<AppEnv>) {
  app.get("/oauth/config", requireAuth, (c) => {
    return c.json({
      platforms: oauthConfig(),
      mockConnectEnabled: !isMetaConfigured() || !isGoogleConfigured(),
    });
  });

  app.get("/oauth/:platform/start", requireAuth, async (c) => {
    const platform = platformSchema.parse(c.req.param("platform"));
    const clientId = c.req.query("clientId");
    if (!clientId) {
      throw new HTTPException(400, { message: "clientId is required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, clientId);
    await requireWritableCapability(client.workspaceId, platform === "meta" ? "connect.meta" : "connect.google");
    if (!configured(platform)) {
      throw new HTTPException(409, {
        message: `${platform} OAuth is not configured. Use mock connect for local/dev, or set app credentials.`,
      });
    }
    const state = await signOAuthState({
      userId: auth.user.id,
      clientId,
      platform,
    });
    return c.json({ url: authorizeUrl(platform, state), platform });
  });

  app.get("/oauth/:platform/callback", async (c) => {
    const platform = platformSchema.parse(c.req.param("platform"));
    const error = c.req.query("error");
    const code = c.req.query("code");
    const state = c.req.query("state");
    const dest = postConnectDest();
    if (error || !code || !state) {
      dest.searchParams.set("oauth_error", error ?? "missing_code");
      return c.redirect(dest.toString());
    }
    try {
      const parsed = await verifyOAuthState(state);
      if (parsed.platform !== platform) {
        throw new Error("OAuth state platform mismatch");
      }
      const exchanged = await exchangeCode(platform, code);
      const visible = await getDb().query.clients.findFirst({
        where: eq(clients.id, parsed.clientId),
      });
      if (!visible) {
        throw new Error("Client not found for OAuth callback");
      }
      await upsertConnectedAccount({
        workspaceId: visible.workspaceId,
        clientId: visible.id,
        platform,
        externalId: exchanged.externalId,
        scopes: platform === "meta" ? META_SCOPES : GOOGLE_SCOPES,
        tokens: exchanged.tokens,
        label: "live",
      });
      dest.searchParams.set("client", visible.id);
      dest.searchParams.set("connected", platform);
      if (!consoleOrigin()) dest.pathname = `/app/clients/${visible.id}`;
      const connected = await getDb().query.adAccounts.findFirst({
        where: and(eq(adAccounts.clientId, visible.id), eq(adAccounts.platform, platform)),
      });
      if (connected) {
        await sendAdAccountSync({
          requestedBy: parsed.userId,
          workspaceId: visible.workspaceId,
          clientId: visible.id,
          adAccountId: connected.id,
          platform,
        }).catch(() => undefined);
      }
      return c.redirect(dest.toString());
    } catch (err) {
      childLogger(c.get("requestId") ?? "oauth").error({
        msg: "oauth.callback_failed",
        platform,
        error: err instanceof Error ? err.message : "unknown",
      });
      dest.searchParams.set("oauth_error", "exchange_failed");
      return c.redirect(dest.toString());
    }
  });

  app.post("/oauth/mock/connect", requireAuth, async (c) => {
    const parsed = mockConnectSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "clientId and platform are required" });
    }
    const auth = c.get("auth");
    const client = await requireMutableClient(auth, parsed.data.clientId);
    const platform = parsed.data.platform;
    await requireWritableCapability(client.workspaceId, platform === "meta" ? "connect.meta" : "connect.google");
    const slug = client.name.toLowerCase().replace(/\s+/g, "-");
    const row = await upsertConnectedAccount({
      workspaceId: client.workspaceId,
      clientId: client.id,
      platform,
      externalId: platform === "meta" ? `act_mock-${slug}` : `customers/mock-${slug}`,
      scopes: platform === "meta" ? META_SCOPES : GOOGLE_SCOPES,
      label: "mock",
      tokens: {
        accessToken: "mock-access-not-a-real-token",
        refreshToken: "mock-refresh-not-a-real-token",
        mock: true,
        scopes: platform === "meta" ? META_SCOPES : GOOGLE_SCOPES,
      },
    });
    childLogger(c.get("requestId")).info({
      msg: "oauth.mock_connect",
      platform,
      clientId: client.id,
      adAccountId: row.id,
    });
    await sendAdAccountSync({
      requestedBy: auth.user.id,
      workspaceId: client.workspaceId,
      clientId: client.id,
      adAccountId: row.id,
      platform,
    }).catch(() => undefined);
    const tokens = await loadTokens(row.id);
    return c.json({ adAccount: toPublicAccount(row, tokens) });
  });

  app.get("/clients/:id/ad-accounts", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    return c.json({ adAccounts: await listPublicAdAccounts(client.id) });
  });

  app.post("/ad-accounts/:id/sync", requireAuth, async (c) => {
    try {
      const result = await enqueueAccountSync(c.get("auth"), c.req.param("id"));
      childLogger(c.get("requestId")).info({
        msg: "jobs.sync_enqueued",
        event: result.name,
        jobId: result.jobId,
        adAccountId: result.adAccountId,
      });
      return c.json({ ...result, status: "queued" });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      childLogger(c.get("requestId")).error({ err: error, msg: "jobs.sync_send_failed" });
      throw new HTTPException(503, {
        message: "Inngest is not reachable. Start the local Dev Server (npm run ads:dev:inngest).",
      });
    }
  });

  app.post("/ad-accounts/:id/disconnect", requireAuth, async (c) => {
    const row = await disconnectAccount(c.get("auth"), c.req.param("id"));
    const tokens = await loadTokens(row.id);
    return c.json({ adAccount: toPublicAccount(row, tokens) });
  });

  app.patch("/ad-accounts/:id", requireAuth, async (c) => {
    const parsed = z.object({ frozen: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "frozen is required" });
    }
    const row = await setAccountFrozen(c.get("auth"), c.req.param("id"), parsed.data.frozen);
    const tokens = await loadTokens(row.id);
    return c.json({ adAccount: toPublicAccount(row, tokens) });
  });

  app.get("/ad-accounts/:id", requireAuth, async (c) => {
    const account = await requireVisibleAccount(c.get("auth"), c.req.param("id"));
    if (!account) {
      throw new HTTPException(404, { message: "Ad account not found" });
    }
    const tokens = await loadTokens(account.id);
    return c.json({
      adAccount: toPublicAccount(account, tokens),
      entities: await listEntities(account.id),
    });
  });
}
