import { describe, expect, it } from "vitest";
import * as shared from "@tharros/ads-shared";

describe("@tharros/ads-shared root barrel", () => {
  it("does not export Node-only helpers that pull node:fs into ads-web", () => {
    expect(shared).not.toHaveProperty("loadEnv");
    expect(shared).not.toHaveProperty("requiredEnv");
    expect(shared).not.toHaveProperty("encryptSecret");
    expect(shared).not.toHaveProperty("oauthConfig");
    expect(shared).not.toHaveProperty("metaAdPlatformConnector");
    expect(shared).not.toHaveProperty("callRailConnector");
  });
});
