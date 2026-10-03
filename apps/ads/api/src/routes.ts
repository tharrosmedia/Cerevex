import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  GOOGLE_SCOPES,
  META_SCOPES,
  isGoogleConfigured,
  isMetaConfigured,
  oauthConfig,
  webOrigin,
} from "@tharros/ads-shared/oauth";
import { getAdPlatformConnector } from "@tharros/ads-shared/connectors";
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
import { connectChosenAccounts, createPendingConnection } from "./pending-connect";
import type { AccessibleAdAccount } from "@tharros/ads-shared";
import { EntitlementError } from "@tharros/ads-shared/entitlements";
import { actorRef } from "./auth";
import { requireWritableCapability } from "./capabilities";
import { getVisibleClient } from "./tenancy";
import type { AppEnv } from "./types";

const platformSchema = z.enum(["meta", "google"]);
const mockConnectSchema = z.object({
  clientId: z.string().uuid(),
  platform: platformSchema,
});

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
    const connector = getAdPlatformConnector(platform);
    await requireWritableCapability(client.workspaceId, connector.connectCapability);
    if (!connector.isConfigured()) {
      throw new HTTPException(409, {
        message: `${platform} OAuth is not configured. Use mock connect for local/dev, or set app credentials.`,
      });
    }
    const state = await signOAuthState({
      userId: actorRef(auth),
      clientId,
      platform,
    });
    return c.json({ url: connector.authorizeUrl(state), platform });
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
      const connector = getAdPlatformConnector(platform);
      const visible = await getDb().query.clients.findFirst({
        where: eq(clients.id, parsed.clientId),
      });
      if (!visible) {
        throw new Error("Client not found for OAuth callback");
      }
      await requireWritableCapability(visible.workspaceId, connector.connectCapability);
      const exchanged = await exchangeCode(platform, code);

      let accounts: AccessibleAdAccount[];
      try {
        accounts = await connector.listAccessibleAccounts(exchanged.tokens);
      } catch (listError) {
        childLogger(c.get("requestId") ?? "oauth").error({
          msg: "oauth.list_accounts_failed",
          platform,
          error: listError instanceof Error ? listError.message : "unknown",
        });
        dest.searchParams.set("oauth_error", "list_failed");
        return c.redirect(dest.toString());
      }
      if (accounts.length === 0) {
        dest.searchParams.set("oauth_error", "no_accounts");
        return c.redirect(dest.toString());
      }

      if (accounts.length === 1) {
        await connectChosenAccounts({
          workspaceId: visible.workspaceId,
          clientId: visible.id,
          platform,
          requestedBy: parsed.userId,
          tokens: exchanged.tokens,
          accounts,
        });
        dest.searchParams.set("client", visible.id);
        dest.searchParams.set("connected", platform);
        if (!consoleOrigin()) dest.pathname = `/app/clients/${visible.id}`;
        return c.redirect(dest.toString());
      }

      // More than one account: the owner picks which ones belong to this site.
      if (!consoleOrigin()) {
        dest.searchParams.set("oauth_error", "choose_in_console");
        return c.redirect(dest.toString());
      }
      const pendingId = await createPendingConnection({
        workspaceId: visible.workspaceId,
        clientId: visible.id,
        platform,
        userId: parsed.userId,
        tokens: exchanged.tokens,
        accounts,
      });
      const choose = new URL("/ads/connect/choose", consoleOrigin());
      choose.searchParams.set("pending", pendingId);
      return c.redirect(choose.toString());
    } catch (err) {
      if (err instanceof EntitlementError) {
        dest.searchParams.set("oauth_error", "plan_limit");
        dest.searchParams.set("connect_error", err.message);
        return c.redirect(dest.toString());
      }
      if (err instanceof HTTPException && err.status === 409) {
        dest.searchParams.set("oauth_error", "capability_off");
        return c.redirect(dest.toString());
      }
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
    await requireWritableCapability(client.workspaceId, getAdPlatformConnector(platform).connectCapability);
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
      requestedBy: actorRef(auth),
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
