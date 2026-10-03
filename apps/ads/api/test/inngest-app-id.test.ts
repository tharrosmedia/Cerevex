import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADS_INNGEST_APP_ID_DEFAULT, resolveAdsInngestAppId } from "@tharros/ads-shared/inngest";

describe("ads Inngest app id", () => {
  it("uses OS_INNGEST_APP_ID or cerevex-ads and never INNGEST_APP_ID", () => {
    expect(ADS_INNGEST_APP_ID_DEFAULT).toBe("cerevex-ads");
    expect(resolveAdsInngestAppId({})).toBe("cerevex-ads");
    expect(resolveAdsInngestAppId({ INNGEST_APP_ID: "Cerevex" })).toBe("cerevex-ads");
    expect(resolveAdsInngestAppId({ OS_INNGEST_APP_ID: "   ", INNGEST_APP_ID: "Cerevex" })).toBe("cerevex-ads");
    expect(resolveAdsInngestAppId({ OS_INNGEST_APP_ID: "cerevex-ads", INNGEST_APP_ID: "Cerevex" })).toBe(
      "cerevex-ads",
    );
    expect(resolveAdsInngestAppId({ OS_INNGEST_APP_ID: " custom-ads ", INNGEST_APP_ID: "Cerevex" })).toBe(
      "custom-ads",
    );
  });

  it("does not read Brain's app id env in the ads client source", () => {
    const clientSrc = readFileSync(new URL("../../shared/src/inngest.ts", import.meta.url), "utf8");
    expect(clientSrc).toContain("OS_INNGEST_APP_ID");
    expect(clientSrc).toContain('"cerevex-ads"');
    expect(clientSrc).not.toContain("process.env.INNGEST_APP_ID");
    const brainSrc = readFileSync(new URL("../../../../jobs/seo/src/client.ts", import.meta.url), "utf8");
    expect(brainSrc).toContain("process.env.INNGEST_APP_ID || 'Cerevex'");
  });
});
