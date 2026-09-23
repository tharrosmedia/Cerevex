import { afterEach, describe, expect, it } from "vitest";
import {
  OPERATOR_CAPABILITY_CATALOG_LIST,
  applyEnvKills,
  canApproveWithApply,
  capabilityOnBlockedReason,
  defaultCapabilityFlags,
  defaultModulesFor,
  envCapabilityKills,
  inferApplyJobType,
  isApplyEnabled,
  isLeadsSurfaceVisible,
  isLegacyAdsWebAllowed,
  isMutationFamilyEnabled,
  legacyAdsWebGate,
  MUTATION_FAMILIES,
  resolveAdsNav,
  resolveWorkspaceCapabilities,
  settingsJsonWithCapabilityOverrides,
} from "@tharros/ads-shared";
import { app, json, login } from "./helpers";

describe("capability registry", () => {
  const prev = {
    CAPABILITY_KILL: process.env.CAPABILITY_KILL,
    CAPABILITY_KILL_APPLY: process.env.CAPABILITY_KILL_APPLY,
    FEATURE_BID_MUTATIONS: process.env.FEATURE_BID_MUTATIONS,
    FEATURE_BUDGET_MUTATIONS: process.env.FEATURE_BUDGET_MUTATIONS,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults core product on and m51 / sealed paths hidden", () => {
    const flags = defaultCapabilityFlags();
    expect(flags.cockpit).toBe("on");
    expect(flags.apply).toBe("on");
    expect(flags["connect.meta"]).toBe("on");
    expect(flags["connect.google"]).toBe("on");
    expect(flags.audits).toBe("on");
    expect(flags["apply.create_entity"]).toBe("hidden");
    expect(flags["shell.legacy_ads_web"]).toBe("hidden");
    expect(flags["m51.budget_shift"]).toBe("hidden");
    expect(flags["m51.ga4_connect"]).toBe("hidden");
    expect(flags["m51.brainstorm"]).toBe("hidden");
  });

  it("keeps unfinished m51 flags out of operator Settings and refuses on", () => {
    expect(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.group === "m51")).toBe(false);
    expect(capabilityOnBlockedReason("m51.brainstorm", "on")).toMatch(/not live yet/);
    expect(capabilityOnBlockedReason("m51.budget_shift", "recommend_only")).toBeNull();
    expect(capabilityOnBlockedReason("shell.legacy_ads_web", "on")).toBeNull();
  });

  it("hides the leads/brainstorm surface unless m51.brainstorm is visible", () => {
    const modules = defaultModulesFor("home_service");
    expect(modules.leads).toBe(true);
    expect(isLeadsSurfaceVisible(modules, defaultCapabilityFlags())).toBe(false);
    expect(
      resolveAdsNav({ shell: "inShell", modules }).some((item) => item.id === "leads"),
    ).toBe(false);
    expect(
      resolveAdsNav({ shell: "legacyWeb", modules }).some((item) => item.href === "/app/brainstorm"),
    ).toBe(false);

    const staged = { ...defaultCapabilityFlags(), "m51.brainstorm": "recommend_only" as const };
    expect(isLeadsSurfaceVisible(modules, staged)).toBe(true);
    expect(resolveAdsNav({ shell: "inShell", modules, capabilities: staged }).some((item) => item.id === "leads")).toBe(
      true,
    );
    expect(isLeadsSurfaceVisible({ ...modules, leads: false }, staged)).toBe(false);
  });

  it("keeps other settings_json keys when writing capabilities", () => {
    const next = settingsJsonWithCapabilityOverrides({ vertical: "hvac", modules: defaultModulesFor("agency") }, {
      audits: "hidden",
    });
    expect(next.vertical).toBe("hvac");
    expect((next.capabilities as { audits: string }).audits).toBe("hidden");
  });

  it("applies env global kill and legacy bid/budget flags", () => {
    const env = {
      CAPABILITY_KILL: "audits",
      CAPABILITY_KILL_APPLY: "1",
      FEATURE_BID_MUTATIONS: "0",
      FEATURE_BUDGET_MUTATIONS: "false",
    };
    expect(envCapabilityKills(env).sort()).toEqual(["apply", "apply.bid", "apply.budget", "audits"]);
    const flags = applyEnvKills(defaultCapabilityFlags(), env);
    expect(flags.apply).toBe("hidden");
    expect(flags.audits).toBe("hidden");
    expect(flags["apply.bid"]).toBe("hidden");
    expect(flags["apply.budget"]).toBe("hidden");
    expect(flags.cockpit).toBe("on");
  });

  it("never throws on garbage settings_json", () => {
    expect(() => resolveWorkspaceCapabilities(null)).not.toThrow();
    expect(() => resolveWorkspaceCapabilities("nope")).not.toThrow();
    expect(resolveWorkspaceCapabilities({ capabilities: { cockpit: "maybe" } }).cockpit).toBe("on");
  });

  it("maps bid/budget families onto the registry", () => {
    const off = resolveWorkspaceCapabilities({ capabilities: { "apply.bid": "hidden", "apply.budget": "hidden" } });
    expect(isMutationFamilyEnabled(MUTATION_FAMILIES.bid, off)).toBe(false);
    expect(isMutationFamilyEnabled(MUTATION_FAMILIES.budget, off)).toBe(false);
    expect(isMutationFamilyEnabled(MUTATION_FAMILIES.pause, off)).toBe(true);
    expect(inferApplyJobType([{ action: "create_ad" }, { action: "add_keyword" }])).toBe("create_entity");
    expect(inferApplyJobType([{ action: "pause" }, { action: "create_ad" }])).toBe("mutate_existing");
  });

  it("hard-blocks leftover ads-web unless shell.legacy_ads_web is on", () => {
    const flags = defaultCapabilityFlags();
    expect(isLegacyAdsWebAllowed(flags)).toBe(false);
    expect(legacyAdsWebGate({ loading: false, authenticated: true, capabilities: flags })).toBe("block");
    expect(
      legacyAdsWebGate({
        loading: false,
        authenticated: true,
        capabilities: { ...flags, "shell.legacy_ads_web": "on" },
      }),
    ).toBe("allow");
    expect(
      legacyAdsWebGate({
        loading: false,
        authenticated: true,
        capabilities: { ...flags, "shell.legacy_ads_web": "recommend_only" },
      }),
    ).toBe("block");
  });

  it("ANDs apply into Approve the same way in-shell does", () => {
    const flags = defaultCapabilityFlags();
    expect(isApplyEnabled(flags)).toBe(true);
    expect(canApproveWithApply(true, flags)).toBe(true);
    expect(canApproveWithApply(true, { ...flags, apply: "hidden" })).toBe(false);
    expect(canApproveWithApply(true, { ...flags, apply: "recommend_only" })).toBe(false);
    expect(canApproveWithApply(false, flags)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("PATCH /workspace capabilities", () => {
  it("flips a workspace flag and keeps the read path up", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const before = await app.request("/workspace", { headers: { authorization: `Bearer ${token}` } });
    const beforeBody = await json(before);
    expect(before.status).toBe(200);
    expect((beforeBody.workspace as { capabilities: { cockpit: string } }).capabilities.cockpit).toBe("on");
    expect(beforeBody.capabilityCatalog).toBeTruthy();

    const hidden = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "m51.budget_shift": "recommend_only", audits: "hidden" } }),
    });
    const hiddenBody = await json(hidden);
    expect(hidden.status).toBe(200);
    const caps = (hiddenBody.workspace as { capabilities: Record<string, string> }).capabilities;
    expect(caps["m51.budget_shift"]).toBe("recommend_only");
    expect(caps.audits).toBe("hidden");
    expect(caps.cockpit).toBe("on");

    const live = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "m51.brainstorm": "on" } }),
    });
    expect(live.status).toBe(409);
    const liveBody = await json(live);
    expect(String(liveBody.message ?? liveBody.error ?? "")).toMatch(/not live yet/);

    const read = await app.request("/workspace", { headers: { authorization: `Bearer ${token}` } });
    expect(read.status).toBe(200);
    const clients = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    expect(clients.status).toBe(200);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: (beforeBody.workspace as { capabilities: Record<string, string> }).capabilities,
      }),
    });
  });

  it("refuses Meta mock connect when connect.meta is off without taking the read path down", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const clientId = clients.find((row) => row.name === "Got Ductless")?.id;
    expect(clientId).toBeTruthy();

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.meta": "hidden" } }),
    });

    const blocked = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "meta" }),
    });
    expect(blocked.status).toBe(409);
    const stillReadable = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    expect(stillReadable.status).toBe(200);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.meta": "on" } }),
    });
  });

  it("rejects OAuth callback when connect.meta is off before upserting tokens", async () => {
    const { signOAuthState } = await import("../src/oauth-state");
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const clientId = clients.find((row) => row.name === "Got Ductless")?.id;
    expect(clientId).toBeTruthy();

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.meta": "hidden" } }),
    });

    const state = await signOAuthState({
      userId: "00000000-0000-0000-0000-000000000001",
      clientId: clientId!,
      platform: "meta",
    });
    const callback = await app.request(`/oauth/meta/callback?code=not-a-real-code&state=${encodeURIComponent(state)}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location") ?? "").toMatch(/oauth_error=capability_off/);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.meta": "on" } }),
    });
  });

  it("refuses sync and disconnect when connect.google is off", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const clientsRes = await app.request("/clients", { headers: { authorization: `Bearer ${token}` } });
    const clients = (await json(clientsRes)).clients as { id: string; name: string }[];
    const clientId = clients.find((row) => row.name === "Got Ductless")?.id;
    expect(clientId).toBeTruthy();

    const connect = await app.request("/oauth/mock/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ clientId, platform: "google" }),
    });
    expect(connect.status).toBe(200);
    const accountId = String(((await json(connect)).adAccount as { id: string }).id);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.google": "hidden" } }),
    });

    const sync = await app.request(`/ad-accounts/${accountId}/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sync.status).toBe(409);

    const disconnect = await app.request(`/ad-accounts/${accountId}/disconnect`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(disconnect.status).toBe(409);

    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { "connect.google": "on" } }),
    });
  });
});
