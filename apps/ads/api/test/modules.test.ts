import { describe, expect, it } from "vitest";
import {
  defaultModulesFor,
  parseWorkspaceModuleSettings,
  settingsJsonWithBusinessType,
  unboardedModules,
} from "@shopify-brain/contracts";
import { applyBusinessTypeSettings, applyModuleOverrideSettings, readWorkspaceModules } from "@tharros/ads-shared";
import { app, json, login } from "./helpers";

describe("Modules & Nav IA 1.1 defaults", () => {
  it("locks Leads on, Clients only for agency, Sales only for ecommerce", () => {
    expect(defaultModulesFor("home_service")).toEqual({
      leads: true,
      clients: false,
      sales: false,
      workflows: true,
    });
    expect(defaultModulesFor("agency")).toEqual({
      leads: true,
      clients: true,
      sales: false,
      workflows: true,
    });
    expect(defaultModulesFor("ecommerce")).toEqual({
      leads: true,
      clients: false,
      sales: true,
      workflows: true,
    });
  });

  it("hides Clients and Sales before onboarding", () => {
    const parsed = parseWorkspaceModuleSettings({ vertical: "hvac" });
    expect(parsed.onboardingComplete).toBe(false);
    expect(parsed.businessType).toBeNull();
    expect(parsed.modules).toEqual(unboardedModules());
    expect(parsed.modules.clients).toBe(false);
    expect(parsed.modules.sales).toBe(false);
    expect(parsed.modules.leads).toBe(true);
  });

  it("applies business type defaults and keeps other settings_json keys", () => {
    const next = settingsJsonWithBusinessType({ vertical: "hvac", stage: "m1-spine" }, "home_service", "2026-09-22T00:00:00.000Z");
    expect(next.vertical).toBe("hvac");
    expect(next.stage).toBe("m1-spine");
    expect(next.businessType).toBe("home_service");
    expect(next.modules).toEqual(defaultModulesFor("home_service"));
    expect(readWorkspaceModules(next).onboardingComplete).toBe(true);
  });

  it("lets Settings override flags without changing business type", () => {
    const afterType = applyBusinessTypeSettings({ vertical: "hvac" }, "home_service");
    const afterToggle = applyModuleOverrideSettings(afterType, { clients: true, sales: false });
    const parsed = readWorkspaceModules(afterToggle);
    expect(parsed.businessType).toBe("home_service");
    expect(parsed.modules.clients).toBe(true);
    expect(parsed.modules.leads).toBe(true);
    expect(parsed.modules.sales).toBe(false);
  });
});

describe("PATCH /workspace modules", () => {
  it("sets agency defaults then allows a Sales override", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    expect(token).toBeTruthy();

    const before = await app.request("/workspace", {
      headers: { authorization: `Bearer ${token}` },
    });
    const beforeBody = await json(before);
    const previous = beforeBody.workspace as Record<string, unknown>;

    const typed = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ businessType: "ecommerce" }),
    });
    const typedBody = await json(typed);
    expect(typed.status).toBe(200);
    expect((typedBody.workspace as { businessType: string }).businessType).toBe("ecommerce");
    expect((typedBody.workspace as { modules: { leads: boolean; clients: boolean; sales: boolean } }).modules).toEqual({
      leads: true,
      clients: false,
      sales: true,
      workflows: true,
    });

    const overridden = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ modules: { clients: true } }),
    });
    const overriddenBody = await json(overridden);
    expect(overridden.status).toBe(200);
    expect((overriddenBody.workspace as { businessType: string }).businessType).toBe("ecommerce");
    expect((overriddenBody.workspace as { modules: { clients: boolean; sales: boolean } }).modules.clients).toBe(true);
    expect((overriddenBody.workspace as { modules: { clients: boolean; sales: boolean } }).modules.sales).toBe(true);

    const restoreType = (previous.businessType as string | null) ?? "agency";
    await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        businessType: restoreType,
        modules: previous.modules ?? defaultModulesFor("agency"),
      }),
    });
  });

  it("rejects empty patches", async () => {
    const { token } = await login("adam@tharrosmedia.com", "local-dev-only");
    const res = await app.request("/workspace", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
