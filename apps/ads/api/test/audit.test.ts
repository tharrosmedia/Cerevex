import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "@tharros/ads-shared/env";
import { closeDb, getDb } from "@tharros/ads-shared/db";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { applyJobs, recommendations } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";
import { app, ensureScopedUser, json, login } from "./helpers";

loadEnv();

describe("M3 audit → findings → recommendations", () => {
  let ownerToken = "";
  let scopedToken = "";
  let clientId = "";
  let otherClientId = "";
  let accountId = "";
  let recommendationId = "";
  let auditRunId = "";

  beforeAll(async () => {
    await ensureScopedUser();
    ownerToken = (
      await login(
        process.env.SEED_OWNER_EMAIL ?? "adam@tharrosmedia.com",
        process.env.SEED_OWNER_PASSWORD ?? "local-dev-only",
      )
    ).token;
    scopedToken = (await login("pilot.readonly@tharrosmedia.com", "readonly-local-only")).token;

    const clientsRes = await app.request("/clients", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    clientId = clients.find((c) => c.name === "Got Ductless")?.id ?? "";
    otherClientId = clients.find((c) => c.name === "KC Prestige")?.id ?? "";

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "meta" }),
    });
    accountId = String(((await json(connect)).adAccount as { id: string }).id);
    const synced = await runAdAccountSync(accountId);
    expect(synced.mode).toBe("mock");
    expect(synced.status).toBe("connected");
  });

  afterAll(async () => {
    await closeDb();
  });

  it("runs an inline mock audit and persists schema-valid recs without platform writes", async () => {
    const res = await app.request(`/clients/${clientId}/audits`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inline: true, adAccountId: accountId }),
    });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.writes).toBe(false);
    expect(body.inline).toBe(true);
    expect(body.name).toBe("ads/audit.requested");
    const findings = body.findings as { title: string; body: { writes?: boolean } }[];
    const recs = body.recommendations as {
      id: string;
      status: string;
      schemaVersion: string;
      proposedMutations: { execute?: boolean }[];
    }[];
    expect(findings.length).toBeGreaterThan(0);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((row) => row.status === "proposed")).toBe(true);
    expect(recs.every((row) => row.schemaVersion === "1")).toBe(true);
    expect(recs.every((row) => row.proposedMutations.every((mutation) => mutation.execute === false))).toBe(
      true,
    );
    expect(JSON.stringify(body)).not.toContain("graph.facebook.com");
    expect(JSON.stringify(body)).not.toContain("googleads.googleapis.com");
    auditRunId = String((body.audit as { id: string }).id);
    recommendationId = recs[0]!.id;

    const stored = await getDb().query.recommendations.findFirst({
      where: eq(recommendations.id, recommendationId),
    });
    expect(stored?.status).toBe("proposed");
  });

  it("lists audits for the owner and hides them from another tenant", async () => {
    const list = await app.request(`/clients/${clientId}/audits`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(list.status).toBe(200);
    const listed = (await json(list)).audits as { id: string }[];
    expect(listed.some((row) => row.id === auditRunId)).toBe(true);

    const leakList = await app.request(`/clients/${otherClientId}/audits`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(leakList.status).toBe(404);

    const leakAudit = await app.request(`/audits/${auditRunId}`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(leakAudit.status).toBe(200);

    const otherConnect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId: otherClientId, platform: "google" }),
    });
    const otherAccountId = String(((await json(otherConnect)).adAccount as { id: string }).id);
    await runAdAccountSync(otherAccountId);
    const otherAudit = await app.request(`/clients/${otherClientId}/audits`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inline: true }),
    });
    const otherId = String(((await json(otherAudit)).audit as { id: string }).id);
    const scopedOther = await app.request(`/audits/${otherId}`, {
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(scopedOther.status).toBe(404);
  });

  it("blocks Approve while the kill switch is on, then applies after it is turned off", async () => {
    const blocked = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", note: "M5 — should block" }),
    });
    expect(blocked.status).toBe(409);
    const blockedBody = await json(blocked);
    expect(String(blockedBody.error)).toMatch(/paused/i);

    const flip = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: false }),
    });
    expect(flip.status).toBe(200);

    const decide = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", note: "M5 smoke", inline: true }),
    });
    const decided = await json(decide);
    expect(decide.status).toBe(200);
    expect((decided.recommendation as { status: string }).status).toBe("authorized");
    expect((decided.authorization as { id: string } | null)?.id).toBeTruthy();
    expect((decided.applyJob as { status: string }).status).toBe("succeeded");
    expect(decided.writes).toBe(true);

    const jobs = await getDb()
      .select()
      .from(applyJobs)
      .where(eq(applyJobs.authorizationId, String((decided.authorization as { id: string }).id)));
    expect(jobs[0]?.status).toBe("succeeded");

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ applyKillSwitch: true }),
    });
  });

  it("never writes platforms on deny or snooze", async () => {
    const recs = await app.request(`/clients/${clientId}/recommendations`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const open = ((await json(recs)).recommendations as { id: string; status: string }[]).find(
      (row) => row.status === "proposed",
    );
    expect(open?.id).toBeTruthy();
    const before = await getDb().select().from(applyJobs);
    const deny = await app.request(`/recommendations/${open!.id}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(deny.status).toBe(200);
    const denied = await json(deny);
    expect(denied.writes).toBe(false);
    expect(denied.applyJob).toBeNull();
    const after = await getDb().select().from(applyJobs);
    expect(after.length).toBe(before.length);
  });

  it("blocks client_readonly from starting audits or deciding", async () => {
    const start = await app.request(`/clients/${clientId}/audits`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ inline: true }),
    });
    expect(start.status).toBe(403);

    const decide = await app.request(`/recommendations/${recommendationId}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny" }),
    });
    expect(decide.status).toBe(403);
  });

  it("exposes kill switch and canApprove for the Adam owner", async () => {
    const res = await app.request("/workspace", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect((body.workspace as { modules: { leads: boolean } }).modules.leads).toBe(true);
    expect(body.canApprove).toBe(true);
  });
});
