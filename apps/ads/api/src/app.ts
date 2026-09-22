import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { EVENTS, canMutate, oauthConfig } from "@tharros/ads-shared";
import { checkDatabase, getDb } from "@tharros/ads-shared/db";
import { checkInngest, sendStubPing } from "@tharros/ads-shared/inngest";
import { auditLog } from "@tharros/ads-shared/schema";
import { registerAuditRoutes } from "./audits";
import { clientConnectionSummary, listPublicAdAccounts } from "./connect";
import { registerConnectRoutes } from "./routes";
import type { AppEnv } from "./types";
import {
  authenticate,
  extractBearer,
  loadAuthContext,
  sessionCookieName,
  signSession,
  verifySession,
} from "./auth";
import { childLogger, newRequestId } from "./logger";
import { getVisibleClient, listVisibleClients, TenancyError } from "./tenancy";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const stubJobSchema = z.object({
  note: z.string().max(500).optional(),
  clientId: z.string().uuid().optional(),
});

const JOB_AUDIT_ACTIONS = [
  "jobs.stub_enqueued",
  "jobs.stub_complete",
  "jobs.apply_blocked",
  "jobs.audit_enqueued",
  "jobs.audit_complete",
  "jobs.audit_failed",
];

export const VERSION = "0.1.0";

const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c.req.header("authorization")) ?? getCookie(c, sessionCookieName());
  if (!token) {
    throw new HTTPException(401, { message: "Sign in required" });
  }
  try {
    const session = await verifySession(token);
    const auth = await loadAuthContext(session.userId);
    if (!auth) {
      throw new HTTPException(401, { message: "Session user no longer exists" });
    }
    c.set("auth", auth);
    await next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(401, { message: "Invalid or expired session" });
  }
});

export function createApp() {
  const app = new Hono<AppEnv>();
  const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:43181";

  app.use(
    "*",
    cors({
      origin: webOrigin,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
    }),
  );

  app.use("*", async (c, next) => {
    const requestId = newRequestId(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    const log = childLogger(requestId);
    const started = Date.now();
    await next();
    log.info({
      msg: "request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    if (error instanceof TenancyError) {
      return c.json({ error: error.message, requestId }, 403);
    }
    if (error instanceof HTTPException) {
      return c.json({ error: error.message, requestId }, error.status);
    }
    childLogger(requestId).error({ err: error, msg: "unhandled_error" });
    return c.json({ error: "Internal server error", requestId }, 500);
  });

  app.get("/health", async (c) => {
    const [dbOk, inngestStatus] = await Promise.all([
      checkDatabase().catch(() => false),
      checkInngest(),
    ]);
    const ok = Boolean(dbOk);
    return c.json(
      {
        ok,
        service: "tharros-api",
        version: VERSION,
        time: new Date().toISOString(),
        checks: {
          db: dbOk ? "ok" : "down",
          inngest: inngestStatus,
        },
        oauth: oauthConfig(),
      },
      ok ? 200 : 503,
    );
  });

  app.get("/ready", async (c) => {
    const dbOk = await checkDatabase().catch(() => false);
    return c.json({ ready: dbOk }, dbOk ? 200 : 503);
  });

  app.post("/auth/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HTTPException(400, { message: "Email and password are required" });
    }
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      throw new HTTPException(401, { message: "Invalid email or password" });
    }
    const token = await signSession(user.id, user.email);
    const auth = await loadAuthContext(user.id);
    setCookie(c, sessionCookieName(), token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });
    childLogger(c.get("requestId")).info({
      msg: "auth.login",
      userId: user.id,
      email: user.email,
    });
    return c.json({
      token,
      user: auth?.user,
      memberships: auth?.memberships ?? [],
      clientMemberships: auth?.clientMemberships ?? [],
    });
  });

  app.post("/auth/logout", async (c) => {
    deleteCookie(c, sessionCookieName(), { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/me", requireAuth, (c) => {
    const auth = c.get("auth");
    return c.json({
      user: auth.user,
      memberships: auth.memberships,
      clientMemberships: auth.clientMemberships,
    });
  });

  app.get("/clients", requireAuth, async (c) => {
    const rows = await listVisibleClients(c.get("auth"));
    const clients = [];
    for (const row of rows) {
      const summary = await clientConnectionSummary(row.id);
      clients.push({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        pilotFlag: row.pilotFlag,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        connectedPlatforms: summary.connectedPlatforms,
        lastSyncAt: summary.lastSyncAt,
      });
    }
    return c.json({ clients });
  });

  app.get("/clients/:id", requireAuth, async (c) => {
    const client = await getVisibleClient(c.get("auth"), c.req.param("id"));
    if (!client) {
      throw new HTTPException(404, { message: "Client not found" });
    }
    return c.json({
      client: {
        id: client.id,
        workspaceId: client.workspaceId,
        name: client.name,
        pilotFlag: client.pilotFlag,
        status: client.status,
        createdAt: client.createdAt.toISOString(),
      },
      adAccounts: await listPublicAdAccounts(client.id),
      oauth: oauthConfig(),
      canManage: canMutate(c.get("auth"), client.workspaceId),
    });
  });

  registerConnectRoutes(app, requireAuth);
  registerAuditRoutes(app, requireAuth);

  app.post("/jobs/stub", requireAuth, async (c) => {
    const auth = c.get("auth");
    const parsed = stubJobSchema.safeParse(await c.req.json().catch(() => ({})));
    const note = parsed.success ? parsed.data.note : undefined;
    const clientId = parsed.success ? parsed.data.clientId : undefined;

    let workspaceId = auth.memberships[0]?.workspaceId;
    if (clientId) {
      const client = await getVisibleClient(auth, clientId);
      if (!client) {
        throw new HTTPException(404, { message: "Client not found" });
      }
      workspaceId = client.workspaceId;
    }
    if (!workspaceId) {
      throw new HTTPException(403, { message: "No workspace membership" });
    }

    let eventIds: string[];
    try {
      eventIds = await sendStubPing({
        requestedBy: auth.user.id,
        workspaceId,
        clientId,
        note,
        requestId: c.get("requestId"),
      });
    } catch (error) {
      childLogger(c.get("requestId")).error({ err: error, msg: "jobs.stub_send_failed" });
      throw new HTTPException(503, {
        message: "Inngest is not reachable. Start the local Dev Server (pnpm dev:inngest) or set cloud keys.",
      });
    }

    const jobId = eventIds[0] ?? "unknown";
    await getDb().insert(auditLog).values({
      workspaceId,
      actorType: "user",
      actorId: auth.user.id,
      action: "jobs.stub_enqueued",
      entityType: "inngest_event",
      payloadJson: {
        event: EVENTS.stubPing,
        eventIds,
        note,
        clientId,
      },
    });

    childLogger(c.get("requestId")).info({
      msg: "jobs.stub_enqueued",
      jobId,
      userId: auth.user.id,
    });
    return c.json({
      jobId,
      name: EVENTS.stubPing,
      status: "queued",
    });
  });

  app.get("/jobs", requireAuth, async (c) => {
    const auth = c.get("auth");
    const workspaceIds = auth.memberships.map((m) => m.workspaceId);
    if (workspaceIds.length === 0) {
      return c.json({ jobs: [] });
    }
    const rows = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(inArray(auditLog.workspaceId, workspaceIds), inArray(auditLog.action, JOB_AUDIT_ACTIONS)),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(20);
    return c.json({
      jobs: rows.map((row) => ({
        id: row.id,
        name: (row.payloadJson as { event?: string } | null)?.event ?? row.action,
        state: row.action === "jobs.stub_complete" ? "completed" : "queued",
        timestamp: row.createdAt.toISOString(),
      })),
    });
  });

  return app;
}
