import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import { mockCallRailCalls, mockHcpBookedJobs, summarizeAttribution } from "@tharros/ads-shared/attribution";
import { callRailConnector, housecallProConnector } from "@tharros/ads-shared/connectors";
import { defaultCapabilityFlags, mockPull } from "@tharros/ads-shared";
import { closeDb } from "@tharros/ads-shared/db";
import { app, json, login } from "./helpers";
import { filterOfflineRecommendations } from "../src/offline";

describe("M5.2 CallRail attribution (no live writes)", () => {
  it("joins mock Got Ductless calls to mock campaigns in plain language", () => {
    const pulled = mockPull("google", "Got Ductless");
    const calls = mockCallRailCalls("Got Ductless");
    const summary = summarizeAttribution({
      calls,
      campaigns: pulled.entities
        .filter((entity) => entity.entityType === "campaign")
        .map((entity) => ({ ...entity, platform: "google" as const })),
      bookedJobs: mockHcpBookedJobs("Got Ductless"),
      crmEnabled: true,
    });
    expect(summary.answeredCount).toBeGreaterThan(0);
    expect(summary.joins.some((row) => row.matchedOn === "campaign" && row.campaignName?.includes("Google HVAC"))).toBe(
      true,
    );
    expect(summary.joins.some((row) => row.matchedOn === "unmatched")).toBe(true);
    expect(summary.bookedJoinCount).toBeGreaterThan(0);
    expect(summary.sentences.join(" ")).not.toMatch(/roas|cpa|cpc/i);
    expect(summary.sentences.join(" ")).toMatch(/joined to campaign/i);
  });

  it("emits recommend-only call recs from evaluateAccount when the flag is on", () => {
    const pulled = mockPull("meta", "Got Ductless");
    const result = evaluateAccount({
      workspaceId: randomUUID(),
      clientId: randomUUID(),
      auditRunId: randomUUID(),
      adAccountId: randomUUID(),
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
      offlineSignals: {
        calls: mockCallRailCalls("Got Ductless"),
        bookedJobs: mockHcpBookedJobs("Got Ductless"),
        callrailEnabled: true,
        crmEnabled: true,
      },
    });
    const callRec = result.recommendations.find((row) => row.type === "call_attribution");
    const crmRec = result.recommendations.find((row) => row.type === "crm_booked_job");
    expect(callRec).toBeTruthy();
    expect(crmRec).toBeTruthy();
    expect(recommendationDraftSchema.safeParse(callRec).success).toBe(true);
    expect(callRec?.evidenceJson.writes).toBe(false);
    expect(callRec?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("\"execute\":true");
  });

  it("does not emit call recs when the capability is off", () => {
    const pulled = mockPull("meta", "Got Ductless");
    const result = evaluateAccount({
      workspaceId: randomUUID(),
      clientId: randomUUID(),
      auditRunId: randomUUID(),
      adAccountId: randomUUID(),
      platform: "meta",
      entities: pulled.entities,
      metrics: pulled.metrics,
      offlineSignals: {
        calls: mockCallRailCalls("Got Ductless"),
        callrailEnabled: false,
        crmEnabled: false,
      },
    });
    expect(result.recommendations.some((row) => row.type === "call_attribution")).toBe(false);
    expect(result.findings.some((row) => row.bodyJson.ruleId === "account_snapshot")).toBe(true);
  });

  it("hides offline recs from the inbox when capabilities are hidden", () => {
    const flags = defaultCapabilityFlags();
    const rows = [
      { type: "pause_waste" },
      { type: "call_attribution" },
      { type: "crm_booked_job" },
    ];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.callrail_connect": "on", "m52.crm_join": "recommend_only" }).map(
        (row) => row.type,
      ),
    ).toEqual(["pause_waste", "call_attribution", "crm_booked_job"]);
  });

  it("CallRail mock pull never writes and HCP stays recommend+join", async () => {
    const connected = await callRailConnector.connect({ workspaceId: "ws", clientId: "c", mock: true });
    expect(connected.ok).toBe(true);
    expect(connected.stub).toBe(false);
    const pulled = await callRailConnector.pullCalls({
      workspaceId: "ws",
      clientId: "c",
      clientName: "Got Ductless",
      mock: true,
    });
    expect(pulled.ok).toBe(true);
    expect(pulled.calls.length).toBeGreaterThan(0);
    const crm = await housecallProConnector.listBookedJobs({
      workspaceId: "ws",
      clientId: "c",
      clientName: "Got Ductless",
      mock: true,
    });
    expect(crm.writes).toBe(false);
    expect(crm.bookedJobs.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("CallRail connect API (Got Ductless)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("refuses connect when the capability is hidden and stays readable", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const clientId = clients.find((row) => row.name === "Got Ductless")?.id;
    expect(clientId).toBeTruthy();

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "m52.callrail_connect": "hidden" } }),
    });

    const blocked = await app.request("/connectors/callrail/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, mock: true }),
    });
    expect(blocked.status).toBe(409);

    const hidden = await app.request(`/clients/${clientId}/offline-attribution`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(hidden.status).toBe(200);
    const hiddenBody = await json(hidden);
    expect(hiddenBody.visible).toBe(false);

    const clientsStill = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    expect(clientsStill.status).toBe(200);
  });

  it("mock-connects CallRail, pulls calls, and joins them in plain language", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const clientId = clients.find((row) => row.name === "Got Ductless")?.id;
    expect(clientId).toBeTruthy();

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "m52.callrail_connect": "on", "m52.crm_join": "on" } }),
    });

    await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "google" }),
    });

    const connect = await app.request("/connectors/callrail/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, mock: true }),
    });
    expect(connect.status).toBe(200);
    const connectBody = await json(connect);
    expect(connectBody.writes).toBe(false);
    expect((connectBody.callrail as { mock: boolean }).mock).toBe(true);

    const crm = await app.request("/connectors/crm/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, mock: true }),
    });
    expect(crm.status).toBe(200);

    const pull = await app.request("/connectors/callrail/pull", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    expect(pull.status).toBe(200);
    const pullBody = await json(pull);
    expect(pullBody.writes).toBe(false);
    expect(JSON.stringify(pullBody)).not.toMatch(/apiKey|encryptedApiKey|CALLRAIL_API_KEY/);
    expect((pullBody.sentences as string[]).join(" ")).toMatch(/call/i);

    const view = await app.request(`/clients/${clientId}/offline-attribution`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(view.status).toBe(200);
    const viewBody = await json(view);
    expect(viewBody.visible).toBe(true);
    expect((viewBody.joins as unknown[]).length).toBeGreaterThan(0);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "m52.callrail_connect": "hidden", "m52.crm_join": "hidden" } }),
    });
  });
});
