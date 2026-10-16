import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyOwnerAssertion } from "@cerevex/contracts/owner-assertion";
import { adsApi, ensureSiteClient, linkAdsClientSite, listAdsClients, renameAdsClient } from "../lib/ads-bff";
import { OWNER_ASSERTION_HEADER } from "../lib/owner-assertion";
import { loadLinkedSkillsProfile } from "../lib/skills-profile-load";

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env as Record<string, string | undefined>;
const prev = {
  APP_PASSWORD: env.APP_PASSWORD,
  ADS_API_URL: env.ADS_API_URL,
  ADS_API_TOKEN: env.ADS_API_TOKEN,
  ADS_INTERNAL_KEY: env.ADS_INTERNAL_KEY,
  ADS_INTERNAL_WORKSPACE_ID: env.ADS_INTERNAL_WORKSPACE_ID,
  CEREVEX_OWNER_ASSERTION_SECRET: env.CEREVEX_OWNER_ASSERTION_SECRET,
  CONSOLE_OPERATOR_EMAIL: env.CONSOLE_OPERATOR_EMAIL,
  APPROVE_OPERATOR_EMAILS: env.APPROVE_OPERATOR_EMAILS,
  OWNER_ASSERTION_ENABLED: env.OWNER_ASSERTION_ENABLED,
  NODE_ENV: env.NODE_ENV,
};
const SECRET = Buffer.alloc(32, 4).toString("base64url");
const WID = "11111111-1111-4111-8111-111111111111";
const SESSION = { cookie: "console-secret", internalKey: null };

function restore() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

function enable() {
  env.NODE_ENV = "test";
  env.APP_PASSWORD = "console-secret";
  env.ADS_API_URL = "http://ads.test";
  env.ADS_API_TOKEN = "static-owner-token";
  env.ADS_INTERNAL_KEY = "internal-secret";
  env.ADS_INTERNAL_WORKSPACE_ID = WID;
  env.CEREVEX_OWNER_ASSERTION_SECRET = SECRET;
  env.OWNER_ASSERTION_ENABLED = "1";
  delete env.CONSOLE_OPERATOR_EMAIL;
  delete env.APPROVE_OPERATOR_EMAILS;
}

type Seen = { url: string; method: string; headers: Headers; body: string | null };

const originalFetch = globalThis.fetch;
const seen: Seen[] = [];

function installFetch(status = 200, body: unknown = { clients: [], identities: [], killSwitch: false, snapshotId: "snap", clientId: "c1", token: "cxm_test" }) {
  seen.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function assertionOf(call: Seen): string {
  return call.headers.get(OWNER_ASSERTION_HEADER) ?? "";
}

const bff = readFileSync(join(here, "../lib/ads-bff.ts"), "utf8");
function fnBody(name: string, next: string): string {
  const start = bff.indexOf(`export function ${name}`);
  const end = bff.indexOf(`export function ${next}`);
  assert.ok(start >= 0 && end > start);
  return bff.slice(start, end);
}

try {
  enable();
  installFetch();

  const first = await listAdsClients(SESSION);
  const second = await listAdsClients(SESSION);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(seen.length, 2);
  const tokenA = assertionOf(seen[0]!);
  const tokenB = assertionOf(seen[1]!);
  assert.ok(tokenA);
  assert.ok(tokenB);
  assert.notEqual(tokenA, tokenB);
  for (const call of seen) {
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("x-cerevex-internal-key"), null);
    assert.equal(call.url, "http://ads.test/clients");
    assert.equal(call.method, "GET");
  }
  const verifiedA = verifyOwnerAssertion(tokenA, { current: SECRET, htm: "GET", htu: "/clients" });
  const verifiedB = verifyOwnerAssertion(tokenB, { current: SECRET, htm: "GET", htu: "/clients" });
  assert.equal(verifiedA.ok, true);
  assert.equal(verifiedB.ok, true);
  if (verifiedA.ok && verifiedB.ok) {
    assert.equal(verifiedA.claims.sub, "adam@tharrosmedia.com");
    assert.equal(verifiedA.claims.wid, WID);
    assert.notEqual(verifiedA.claims.jti, verifiedB.claims.jti);
    assert.equal(verifyOwnerAssertion(tokenA, { current: SECRET, htm: "POST", htu: "/clients" }).ok, false);
    assert.equal(verifyOwnerAssertion(tokenA, { current: SECRET, htm: "GET", htu: "/clients?x=1" }).ok, false);
  }

  env.CONSOLE_OPERATOR_EMAIL = "Ops@Example.com";
  env.APPROVE_OPERATOR_EMAILS = "ops@example.com";
  installFetch();
  const named = await adsApi("/mcp/identities", { method: "post" }, { asOwner: true, ownerAssertion: true, assertionCreds: SESSION });
  assert.equal(named.ok, true);
  const posted = verifyOwnerAssertion(assertionOf(seen[0]!), { current: SECRET, htm: "POST", htu: "/mcp/identities" });
  assert.equal(posted.ok, true);
  if (posted.ok) {
    assert.equal(posted.claims.sub, "ops@example.com");
    assert.equal(posted.claims.htm, "POST");
    assert.equal(posted.claims.htu, "/mcp/identities");
  }
  assert.equal(verifyOwnerAssertion(assertionOf(seen[0]!), { current: SECRET, htm: "GET", htu: "/mcp/identities" }).ok, false);

  delete env.OWNER_ASSERTION_ENABLED;
  installFetch();
  const legacy = await listAdsClients();
  assert.equal(legacy.ok, true);
  assert.equal(assertionOf(seen[0]!), "");
  assert.equal(seen[0]!.headers.get("authorization"), "Bearer static-owner-token");
  assert.equal(seen[0]!.headers.get("x-cerevex-internal-key"), null);

  env.OWNER_ASSERTION_ENABLED = "true";
  delete env.CEREVEX_OWNER_ASSERTION_SECRET;
  installFetch(401, { error: "Sign in required" });
  const missing = await listAdsClients(SESSION);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);
  assert.equal(assertionOf(seen[0]!), "");
  assert.equal(seen[0]!.headers.get("authorization"), null);
  assert.equal(seen[0]!.headers.get("x-cerevex-internal-key"), null);

  env.CEREVEX_OWNER_ASSERTION_SECRET = "short";
  installFetch(401, { error: "Sign in required" });
  const short = await adsApi("/mcp/connector", {}, { asOwner: true, ownerAssertion: true, assertionCreds: SESSION });
  assert.equal(short.ok, false);
  assert.equal(assertionOf(seen[0]!), "");
  assert.equal(seen[0]!.headers.get("authorization"), null);

  env.CEREVEX_OWNER_ASSERTION_SECRET = SECRET;
  installFetch(401, { error: "Sign in required" });
  const unsigned = await adsApi("/mcp/identities", {}, { asOwner: true, ownerAssertion: true, assertionCreds: { cookie: null, internalKey: null } });
  assert.equal(unsigned.ok, false);
  assert.equal(assertionOf(seen[0]!), "");
  assert.equal(seen[0]!.headers.get("authorization"), null);

  env.CONSOLE_OPERATOR_EMAIL = "other@example.com";
  delete env.APPROVE_OPERATOR_EMAILS;
  installFetch(401, { error: "Sign in required" });
  const outsider = await listAdsClients(SESSION);
  assert.equal(outsider.ok, false);
  assert.equal(assertionOf(seen[0]!), "");

  delete env.CONSOLE_OPERATOR_EMAIL;
  delete env.ADS_INTERNAL_WORKSPACE_ID;
  installFetch(401, { error: "Sign in required" });
  const noWid = await listAdsClients(SESSION);
  assert.equal(noWid.ok, false);
  assert.equal(assertionOf(seen[0]!), "");
  assert.equal(seen[0]!.headers.get("authorization"), null);

  env.ADS_INTERNAL_WORKSPACE_ID = WID;
  installFetch(200, { clients: [{ id: "c1", workspaceId: WID, name: "Got", siteId: "store-1" }], snapshotId: "snap-1", clientId: "c1" });
  const loaded = await loadLinkedSkillsProfile({ siteId: "store-1", slug: "hvac-usa", creds: SESSION });
  assert.equal(loaded.ok, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.url, "http://ads.test/clients");
  assert.equal(seen[0]!.method, "GET");
  assert.equal(seen[1]!.url, "http://ads.test/clients/c1/skills-profile");
  assert.equal(seen[1]!.method, "POST");
  assert.equal(seen[1]!.body, JSON.stringify({ slug: "hvac-usa" }));
  const listToken = verifyOwnerAssertion(assertionOf(seen[0]!), { current: SECRET, htm: "GET", htu: "/clients" });
  const postToken = verifyOwnerAssertion(assertionOf(seen[1]!), { current: SECRET, htm: "POST", htu: "/clients/c1/skills-profile" });
  assert.equal(listToken.ok, true);
  assert.equal(postToken.ok, true);
  if (listToken.ok && postToken.ok) assert.notEqual(listToken.claims.jti, postToken.claims.jti);
  assert.equal(verifyOwnerAssertion(assertionOf(seen[1]!), { current: SECRET, htm: "POST", htu: "/clients/c1/skills-profile?x=1" }).ok, false);

  assert.match(fnBody("listAdsClients", "renameAdsClient"), /ownerAssertion: true/);
  assert.doesNotMatch(fnBody("ensureSiteClient", "listAdsClients"), /ownerAssertion/);
  assert.doesNotMatch(fnBody("renameAdsClient", "getClientSetup"), /ownerAssertion/);
  assert.doesNotMatch(fnBody("linkAdsClientSite", "connectedPlatforms"), /ownerAssertion/);
  const panel = readFileSync(join(here, "../components/connector-settings-panel.tsx"), "utf8");
  const actions = readFileSync(join(here, "../lib/mcp-connector-actions.ts"), "utf8");
  assert.match(panel, /\/mcp\/connector[\s\S]*ownerAssertion: true/);
  assert.match(panel, /\/mcp\/identities[\s\S]*ownerAssertion: true/);
  assert.equal(actions.match(/ownerAssertion: true/g)?.length, 4);
  assert.equal(actions.match(/asOwner: true/g)?.length, 4);

  const created = await adsApi("/mcp/identities", { method: "POST", body: "{}" }, { asOwner: true, ownerAssertion: true, assertionCreds: SESSION });
  assert.equal(created.ok, true);
  assert.equal(verifyOwnerAssertion(assertionOf(seen.at(-1)!), { current: SECRET, htm: "POST", htu: "/mcp/identities" }).ok, true);

  console.log("owner-assertion: ok");
} finally {
  restore();
}
