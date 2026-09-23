import { afterEach, describe, expect, it } from "vitest";
import {
  OPERATOR_CAPABILITY_CATALOG_LIST,
  applyEnvKills,
  approveOperatorEmails,
  canApproveApply,
  canApproveWithApply,
  capabilityOnBlockedReason,
  DEFAULT_APPROVE_OPERATOR_EMAIL,
  defaultCapabilityFlags,
  defaultModulesFor,
  envCapabilityKills,
  inferApplyJobType,
  isApplyEnabled,
  isLeadsSurfaceVisible,
  isLegacyAdsWebAllowed,
  isMutationFamilyEnabled,
  isPlatformSyncLiveOn,
  legacyAdsChromeLinksAllowed,
  legacyAdsWebGate,
  MUTATION_FAMILIES,
  OPS_ENV_REGISTRY,
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
    PLATFORM_SYNC_LIVE: process.env.PLATFORM_SYNC_LIVE,
    NEXT_PUBLIC_ADS_LEGACY_CHROME: process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME,
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
    expect(flags["sync.live"]).toBe("on");
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

  it("applies env global kill and legacy bid/budget/sync-live flags", () => {
    const env = {
      CAPABILITY_KILL: "audits",
      CAPABILITY_KILL_APPLY: "1",
      FEATURE_BID_MUTATIONS: "0",
      FEATURE_BUDGET_MUTATIONS: "false",
      PLATFORM_SYNC_LIVE: "0",
    };
    expect(envCapabilityKills(env).sort()).toEqual(["apply", "apply.bid", "apply.budget", "audits", "sync.live"]);
    const flags = applyEnvKills(defaultCapabilityFlags(), env);
    expect(flags.apply).toBe("hidden");
    expect(flags.audits).toBe("hidden");
    expect(flags["apply.bid"]).toBe("hidden");
    expect(flags["apply.budget"]).toBe("hidden");
    expect(flags["sync.live"]).toBe("hidden");
    expect(flags.cockpit).toBe("on");
  });

  it("maps PLATFORM_SYNC_LIVE=0 onto sync.live without treating secrets as flags", () => {
    expect(isPlatformSyncLiveOn(defaultCapabilityFlags())).toBe(true);
    expect(
      isPlatformSyncLiveOn(resolveWorkspaceCapabilities({ capabilities: { "sync.live": "hidden" } })),
    ).toBe(false);
    expect(resolveWorkspaceCapabilities({}, { PLATFORM_SYNC_LIVE: "0" })["sync.live"]).toBe("hidden");
    expect(resolveWorkspaceCapabilities({}, { PLATFORM_SYNC_LIVE: "1" })["sync.live"]).toBe("on");
    expect(OPS_ENV_REGISTRY.filter((entry) => entry.kind === "secret").every((entry) => !entry.capability)).toBe(true);
    expect(OPS_ENV_REGISTRY.find((entry) => entry.env === "APPROVE_OPERATOR_EMAILS")?.kind).toBe("identity");
    expect(OPS_ENV_REGISTRY.find((entry) => entry.env === "PLATFORM_SYNC_LIVE")?.capability).toBe("sync.live");
  });

  it("requires shell.legacy_ads_web and NEXT_PUBLIC_ADS_LEGACY_CHROME for leftover chrome links", () => {
    const flags = defaultCapabilityFlags();
    expect(legacyAdsChromeLinksAllowed(flags, { NEXT_PUBLIC_ADS_LEGACY_CHROME: "1" })).toBe(false);
    expect(
      legacyAdsChromeLinksAllowed({ ...flags, "shell.legacy_ads_web": "on" }, { NEXT_PUBLIC_ADS_LEGACY_CHROME: "1" }),
    ).toBe(true);
    expect(
      legacyAdsChromeLinksAllowed({ ...flags, "shell.legacy_ads_web": "on" }, { NEXT_PUBLIC_ADS_LEGACY_CHROME: "0" }),
    ).toBe(false);
    expect(
      legacyAdsChromeLinksAllowed({ ...flags, "shell.legacy_ads_web": "recommend_only" }, {
        NEXT_PUBLIC_ADS_LEGACY_CHROME: "1",
      }),
    ).toBe(false);
  });

  it("keeps Approve identity on APPROVE_OPERATOR_EMAILS (Adam default)", () => {
    expect(approveOperatorEmails({})).toEqual([DEFAULT_APPROVE_OPERATOR_EMAIL]);
    expect(approveOperatorEmails({ APPROVE_OPERATOR_EMAILS: "" })).toEqual([DEFAULT_APPROVE_OPERATOR_EMAIL]);
    expect(approveOperatorEmails({ SEED_OWNER_EMAIL: "other@tharrosmedia.com" })).toEqual([
      DEFAULT_APPROVE_OPERATOR_EMAIL,
    ]);
    expect(approveOperatorEmails({ APPROVE_OPERATOR_EMAILS: "adam@tharrosmedia.com, ops@tharrosmedia.com" })).toEqual([
      "adam@tharrosmedia.com",
      "ops@tharrosmedia.com",
    ]);
    expect(canApproveApply("adam@tharrosmedia.com", {})).toBe(true);
    expect(canApproveApply("operator@tharrosmedia.com", {})).toBe(false);
    expect(canApproveApply("ops@tharrosmedia.com", { APPROVE_OPERATOR_EMAILS: "ops@tharrosmedia.com" })).toBe(true);
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
