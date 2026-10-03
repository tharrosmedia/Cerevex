import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importProfiles } from "../src/import-profiles";
import { valueForClientFacingCopy } from "../src/fact";
import { CLIENT_CONFIG_PATH } from "../src/paths";
import { isLevelAgencyTenant } from "../src/gates";

const bundle = importProfiles();
assert.equal(bundle.snapshotId, "2026-10-03-0720");
assert.deepEqual(
  bundle.clients.map((client) => client.slug),
  ["hvac-usa", "got-ductless", "kc-prestige-hvac", "elmar-hvac", "tharros-media", "cerevex"],
);

const hvac = bundle.clients.find((client) => client.slug === "hvac-usa");
const got = bundle.clients.find((client) => client.slug === "got-ductless");
const cerevex = bundle.clients.find((client) => client.slug === "cerevex");
const tharros = bundle.clients.find((client) => client.slug === "tharros-media");
assert.ok(hvac && got && cerevex && tharros);

assert.equal(hvac.pilot, true);
assert.equal(got.pilot, false);
assert.equal(hvac.marketingGate, "off");
assert.equal(hvac.approvalOwner.state, "known");
assert.equal(hvac.approvalOwnerResolved.name, "Adam");
assert.equal(hvac.approvalOwnerResolved.resolvedFrom, "agency-owner");
assert.equal(hvac.dealerAuthorization?.state, "tbd");
assert.equal(hvac.planningNote?.state, "inference");
assert.equal(valueForClientFacingCopy(hvac.planningNote), null);
assert.equal(hvac.stores.length, 1);
assert.equal(hvac.stores[0]?.storeKey, "hvac-usa/web");
assert.equal(hvac.stores[0]?.geo?.state, "assumption");
assert.equal(hvac.stores[0]?.measurement.conversionTrackingAudit.value, "not_run");
assert.equal(
  hvac.factsRegister.some((row) => /no cage number/i.test(row.fact) && row.state === "known"),
  true,
);
assert.equal(hvac.stores[0]?.site?.value?.includes("Deereco") ?? false, false);
assert.equal(hvac.stores[0]?.geo?.value?.includes("Deereco") ?? false, false);
assert.match(hvac.neverSay?.raw ?? "", /Deereco/);
assert.match(JSON.stringify(hvac.stores[0]?.notes), /local-ductless-stores/);

assert.equal(got.approvalOwner.state, "tbd");
assert.equal(got.approvalOwnerResolved.resolvedFrom, "tbd-default");
assert.equal(got.approvalOwnerResolved.email, "adam@tharrosmedia.com");
assert.deepEqual(
  got.stores.map((store) => store.storeKey),
  ["got-ductless/web", "got-ductless/maryland"],
);
const maryland = got.stores[1];
assert.equal(maryland?.role, "storefront");
assert.equal(maryland?.site?.value, "/pages/local-ductless-stores");
assert.equal(JSON.stringify(maryland).includes("Deereco"), true);
assert.equal(got.stores[0]?.channels.some((channel) => /business profile/i.test(channel.channel)), false);
assert.equal(maryland?.channels.some((channel) => /business profile/i.test(channel.channel)), true);

assert.equal(cerevex.marketingGate, "on");
assert.equal(cerevex.forbidClientNamesAndResults, true);
assert.equal(cerevex.qualifiedOutcome.value, "none (not marketed)");
assert.equal(cerevex.packs.length, 0);
assert.equal(cerevex.dormantPackId, "saas-b2b");
assert.equal(bundle.missingFacts.cerevex.length, 0);
assert.match(bundle.missingFactsMarkdown.cerevex, /No TBD fields/);
assert.equal(cerevex.promptLayer.seeded, false);

assert.equal(tharros.businessModel.state, "inference");
assert.equal(tharros.forbidClientNamesAndResults, true);
assert.equal(hvac.packs[0]?.id, "ecommerce-dtc");
assert.equal(hvac.packs[0]?.version, bundle.libraryVersion);
assert.equal(hvac.packs.some((pack) => pack.id === "home-service" && pack.role === "rule-set"), true);

const hvacMissing = bundle.missingFacts["hvac-usa"];
assert.equal(hvacMissing.some((item) => item.field === "dealerAuthorization"), true);
assert.equal(hvacMissing.some((item) => item.origin === "open-question" && /MAP/.test(item.label)), true);
assert.equal(hvacMissing.some((item) => item.field === "approvalOwner"), false);

assert.equal(bundle.missingFacts["got-ductless"].some((item) => item.field === "approvalOwner"), true);
assert.equal(
  bundle.missingFacts["got-ductless"].some((item) => item.storeKey === "got-ductless/web" && item.field === "site"),
  true,
);

for (const client of bundle.clients) {
  assert.equal(isLevelAgencyTenant(client.slug), false);
  assert.equal(client.scopeAllowed, true);
}

const committed = JSON.parse(readFileSync(CLIENT_CONFIG_PATH, "utf8"));
assert.deepEqual(committed, bundle);

console.log("profile tests ok");
