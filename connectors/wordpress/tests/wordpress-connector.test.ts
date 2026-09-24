import assert from "node:assert/strict";
import {
  createWordPressConnector,
  signRequest,
  validateApprovedApplyPayload,
  verifySignature,
} from "../src/index";
import type { SiteCmsApplyPayload } from "@cerevex/contracts";

const approved: SiteCmsApplyPayload = {
  approved: true,
  approvalId: "apr_1",
  approvedAt: "2026-09-24T00:00:00.000Z",
  storeId: "store_1",
  externalId: "12",
  resourceType: "page",
  title: "AC repair in Austin",
  seoTitle: "AC repair",
  seoDescription: "Same-day HVAC service.",
};

const rejected = validateApprovedApplyPayload({ ...approved, approved: false });
assert.equal(rejected.ok, false);
assert.equal("writes" in rejected && rejected.writes, false);
assert.equal("code" in rejected ? rejected.code : "", "unapproved");

const unsignedField = validateApprovedApplyPayload({ ...approved, theme: "rebuild" });
assert.equal(unsignedField.ok, false);
assert.equal("code" in unsignedField ? unsignedField.code : "", "unsupported_field");

const missingApproval = validateApprovedApplyPayload({ ...approved, approvalId: "" });
assert.equal(missingApproval.ok, false);

const signed = signRequest({
  pluginKey: "secret",
  method: "POST",
  path: "/cerevex/v1/apply",
  body: JSON.stringify(approved),
  timestamp: "1000",
});
assert.equal(
  verifySignature({
    pluginKey: "secret",
    method: "POST",
    path: "/cerevex/v1/apply",
    body: JSON.stringify(approved),
    timestamp: "1000",
    signature: signed.signature,
    nowMs: 1000,
  }).ok,
  true,
);
assert.equal(
  verifySignature({
    pluginKey: "secret",
    method: "POST",
    path: "/cerevex/v1/apply",
    body: JSON.stringify(approved),
    timestamp: "1000",
    signature: "00",
    nowMs: 1000,
  }).ok,
  false,
);
assert.equal(
  verifySignature({
    pluginKey: "secret",
    method: "POST",
    path: "/cerevex/v1/apply",
    body: JSON.stringify(approved),
    timestamp: "",
    signature: "",
    nowMs: 1000,
  }).reason,
  "unsigned",
);

const mock = createWordPressConnector({
  siteUrl: "https://hvac-pilot.example",
  pluginKey: "key",
  mock: true,
  mockItems: [
    {
      externalId: "12",
      resourceType: "page",
      handle: "ac-repair",
      title: "Old title",
      bodyHtml: "<p>Old</p>",
      seoTitle: "Old SEO",
    },
  ],
});
const health = await mock.health();
assert.equal(health.ok, true);
const listed = await mock.listContent({ resourceType: "page" });
assert.equal(listed.ok, true);
assert.equal(listed.items[0]?.title, "Old title");
const applied = await mock.apply(approved);
assert.equal(applied.ok, true);
assert.equal(applied.writes, true);
assert.equal(applied.after?.title, "AC repair in Austin");

const down = createWordPressConnector({
  siteUrl: "https://down.example",
  pluginKey: "key",
  fetchImpl: async () => {
    throw new Error("ECONNREFUSED");
  },
});
const downHealth = await down.health();
assert.equal(downHealth.ok, false);
assert.equal(downHealth.code, "unreachable");
assert.equal(downHealth.reason, "Couldn't reach the site.");

const missingPlugin = createWordPressConnector({
  siteUrl: "https://no-plugin.example",
  pluginKey: "key",
  fetchImpl: async () => new Response("Not found", { status: 404 }),
});
const missing = await missingPlugin.health();
assert.equal(missing.ok, false);
assert.equal(missing.code, "plugin_not_found");
assert.equal(missing.reason, "Plugin not found.");

const badAuth = createWordPressConnector({
  siteUrl: "https://wp.example",
  pluginKey: "wrong",
  fetchImpl: async () => new Response(JSON.stringify({ code: "bad_auth" }), { status: 401 }),
});
const denied = await badAuth.listContent();
assert.equal(denied.ok, false);
assert.equal(denied.code, "bad_auth");
assert.deepEqual(denied.items, []);

const empty = createWordPressConnector({ siteUrl: "", pluginKey: "" });
const unconfigured = await empty.health();
assert.equal(unconfigured.ok, false);
assert.equal(unconfigured.code, "not_configured");

console.log("wordpress-connector: ok");
