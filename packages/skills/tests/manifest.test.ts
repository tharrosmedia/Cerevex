import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildManifest, readBannerVersion, sha256 } from "../src/manifest";
import {
  SkillVersionPinError,
  clientPromptLayerPath,
  loadPromptLayerRef,
  loadSharedRef,
  loadTemplate,
  storePromptLayerPath,
} from "../src/loader";
import { MANIFEST_PATH, SKILLS_CONTENT_ROOT } from "../src/paths";
import path from "node:path";
import { PROMPT_LAYER_PRECEDENCE, higherPrecedence } from "../src/prompt-layer";

const manifest = buildManifest();
const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
assert.deepEqual(committed, manifest);
assert.equal(manifest.snapshotId, "2026-10-03-0720");
assert.equal(manifest.algorithm, "sha256-sorted-path-v1");

const expected: Record<string, string> = {
  "paid-media": "0.4.1-accepted",
  "seo-audit": "0.4.1-accepted",
  "seo-research": "1.0-accepted",
  "claims-check": "0.4.1-accepted",
  "no-slop-copy": "3.0.1-accepted",
  "account-review-loop": "0.4.1-accepted",
};
for (const [slug, version] of Object.entries(expected)) {
  const entry = manifest.entries.find((item) => item.slug === slug);
  assert.ok(entry, slug);
  assert.equal(entry.version, version);
  assert.equal(entry.versionSource, "banner");
  assert.match(entry.contentHash, /^[a-f0-9]{64}$/);
  const loaded = loadTemplate(slug as "paid-media", version, manifest);
  assert.equal(loaded.version, version);
  assert.equal(typeof loaded.read, "function");
  assert.throws(() => loadTemplate(slug as "paid-media", "0.0.0-proposed", manifest), SkillVersionPinError);
}

const noSlopPath = path.join(SKILLS_CONTENT_ROOT, "no-slop-copy", "SKILL.md");
const noSlop = readFileSync(noSlopPath, "utf8");
assert.match(noSlop, /version: '3\.0\.1-accepted'/);
assert.match(noSlop, /scope: agency-wide/);
assert.doesNotMatch(noSlop, /^\s*brand:/m);
assert.equal(readBannerVersion(noSlop), "3.0.1-accepted");
assert.equal(sha256(readFileSync(noSlopPath)), "1dd7722a7243fe28dbeac7191208f957565844f82b77f4e56bd1cc25320f8275");

const prompt = manifest.entries.find((item) => item.slug === "prompt-layer");
assert.equal(prompt?.version, "1.0.1");
assert.equal(prompt?.files[0]?.sha256, "69e3d463c490519ad80603125d872ce5aa29cae20580cb3bb19c4108f73097e9");
assert.ok(manifest.entries.some((item) => item.slug === "references/README"));
assert.ok(manifest.entries.some((item) => item.slug === "verticals/README"));
const loadedPrompt = loadPromptLayerRef(manifest);
assert.match(loadedPrompt.body, /Profile facts/);
assert.throws(() => loadedPrompt.read("../SKILL.md"), /Refusing to read/);

const format = loadSharedRef("cerevex-recommendation-format", "1.1", manifest);
assert.match(format.body, /Format version 1.1/);
assert.equal(
  manifest.entries.find((item) => item.slug === "verticals/home-service")?.version,
  manifest.libraryVersion,
);

assert.deepEqual(
  PROMPT_LAYER_PRECEDENCE.map((item) => item.id),
  ["compliance", "profile-facts", "client-layer", "template-defaults"],
);
assert.equal(higherPrecedence("client-layer", "profile-facts"), "profile-facts");
assert.equal(higherPrecedence("template-defaults", "client-layer"), "client-layer");
assert.match(loadedPrompt.body, /No layer anywhere: fall back to the profile silently/);
assert.equal(clientPromptLayerPath("got-ductless"), "clients/got-ductless/prompt-layer.md");
assert.equal(storePromptLayerPath("got-ductless", "maryland"), "clients/got-ductless/prompt-layer-maryland.md");
assert.equal(
  storePromptLayerPath("got-ductless", "got-ductless/maryland"),
  "clients/got-ductless/prompt-layer-maryland.md",
);
assert.equal(storePromptLayerPath("kc-prestige-hvac", "service"), "clients/kc-prestige-hvac/prompt-layer-service.md");

const again = buildManifest();
assert.equal(again.entries.find((item) => item.slug === "paid-media")?.contentHash, expected && manifest.entries.find((item) => item.slug === "paid-media")?.contentHash);

console.log("manifest tests ok");
