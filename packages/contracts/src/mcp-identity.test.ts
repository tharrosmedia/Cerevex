import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateMcpIdentitySlug, parseMcpDisplayName } from "./mcp-identity.ts";

describe("parseMcpDisplayName", () => {
  it("keeps case, spaces, and underscores, and trims", () => {
    assert.equal(parseMcpDisplayName("Grok_Bot"), "Grok_Bot");
    assert.equal(parseMcpDisplayName("Grok Bot"), "Grok Bot");
    assert.equal(parseMcpDisplayName("  Grok_Bot  "), "Grok_Bot");
    assert.equal(parseMcpDisplayName("example-agent"), "example-agent");
    assert.equal(parseMcpDisplayName("Agent #1"), "Agent #1");
    assert.equal(parseMcpDisplayName("A"), "A");
    assert.equal(parseMcpDisplayName("A".repeat(64)), "A".repeat(64));
    assert.equal(parseMcpDisplayName("é".repeat(64)), "é".repeat(64));
    assert.equal(parseMcpDisplayName("Café"), "Café");
    assert.equal(parseMcpDisplayName("CQ 😀 bot"), "CQ 😀 bot");
  });

  it("rejects empty, overlong, and control characters", () => {
    assert.equal(parseMcpDisplayName(""), null);
    assert.equal(parseMcpDisplayName("   "), null);
    assert.equal(parseMcpDisplayName("A".repeat(65)), null);
    assert.equal(parseMcpDisplayName("é".repeat(65)), null);
    assert.equal(parseMcpDisplayName("Grok\nBot"), null);
    assert.equal(parseMcpDisplayName("Grok\tBot"), null);
    assert.equal(parseMcpDisplayName("Grok\u0000Bot"), null);
    assert.equal(parseMcpDisplayName("Grok\u007fBot"), null);
    assert.equal(parseMcpDisplayName("Grok\u0085Bot"), null);
    assert.equal(parseMcpDisplayName("Grok\u009fBot"), null);
    assert.equal(parseMcpDisplayName("Grok\u200B_Bot"), null);
    assert.equal(parseMcpDisplayName("\u202Etob"), null);
    assert.equal(parseMcpDisplayName("a\u200Db"), null);
    assert.equal(parseMcpDisplayName("a\u2066b"), null);
    assert.equal(parseMcpDisplayName("a\u2069b"), null);
    assert.equal(parseMcpDisplayName("a\uFEFFb"), null);
    assert.equal(parseMcpDisplayName(null), null);
    assert.equal(parseMcpDisplayName(12), null);
  });
});

describe("allocateMcpIdentitySlug", () => {
  it("keeps a slug and folds a display name without changing it again", () => {
    assert.equal(allocateMcpIdentitySlug("example-agent", new Set()), "example-agent");
    assert.equal(allocateMcpIdentitySlug("Grok_Bot", new Set()), "grok-bot");
    assert.equal(allocateMcpIdentitySlug("Grok Bot", new Set()), "grok-bot");
    assert.equal(allocateMcpIdentitySlug("A", new Set()), "agent");
    assert.equal(allocateMcpIdentitySlug("Agent #1", new Set()), "agent-1");
    assert.equal(allocateMcpIdentitySlug("----", new Set()), "agent");
    const long = "B".repeat(41);
    assert.equal(allocateMcpIdentitySlug(long, new Set()), "b".repeat(40));
  });

  it("picks the next free slug and does not reuse a taken one", () => {
    const taken = new Set(["grok-bot", "grok-bot-2"]);
    assert.equal(allocateMcpIdentitySlug("Grok_Bot", taken), "grok-bot-3");
    assert.equal(allocateMcpIdentitySlug("Grok_Bot", taken), "grok-bot-3");
    assert.equal(taken.has("grok-bot"), true);
  });
});
