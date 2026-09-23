import { describe, expect, it } from "vitest";
import {
  ADS_DB_SCHEMA,
  ADS_EVENTS,
  ADS_FUNCTION_IDS,
  INNGEST_PREFIXES,
  LEGACY_ADS_EVENTS,
  LEGACY_ADS_FUNCTION_IDS,
  OS_DB_SCHEMA,
  OS_EVENTS,
  PAID_EVENTS,
  SEO_EVENTS,
  SEO_FUNCTION_IDS,
  inngestEventName,
  inngestFunctionId,
} from "@cerevex/contracts";
import { EVENTS, LEGACY_EVENTS } from "@tharros/ads-shared";

describe("R5 / G7 Inngest + G10 Neon naming", () => {
  it("keeps seo/* events and seo-* function ids unchanged", () => {
    expect(INNGEST_PREFIXES.seo).toBe("seo/");
    expect(SEO_EVENTS.jobRequested).toBe("seo/job.requested");
    expect(SEO_EVENTS.auditRequested).toBe("seo/audit.requested");
    expect(SEO_FUNCTION_IDS.job).toBe("seo-job");
    expect(SEO_FUNCTION_IDS.audit).toBe("seo-audit");
    expect(Object.values(SEO_EVENTS).every((name) => name.startsWith("seo/"))).toBe(true);
    expect(Object.values(SEO_FUNCTION_IDS).every((id) => id.startsWith("seo-"))).toBe(true);
  });

  it("uses generic ads/* names with platform as data, not namespace", () => {
    expect(INNGEST_PREFIXES.ads).toBe("ads/");
    expect(ADS_EVENTS.accountSync).toBe("ads/account.sync");
    expect(ADS_EVENTS.applyRequested).toBe("ads/apply.requested");
    expect(ADS_EVENTS.auditRequested).toBe("ads/audit.requested");
    expect(ADS_EVENTS.stubPing).toBe("ads/stub.ping");
    expect(PAID_EVENTS.accountSync).toBe("ads/account.sync");
    expect(PAID_EVENTS.metaAdsAccountSync).toBe("ads/account.sync");
    expect(PAID_EVENTS.googleAdsAccountSync).toBe("ads/account.sync");
    expect(OS_EVENTS.applyRequested).toBe("ads/apply.requested");
    expect(EVENTS.accountSync).toBe("ads/account.sync");
    expect(EVENTS.applyRequested).toBe("ads/apply.requested");
    expect(inngestEventName("ads", "apply.requested")).toBe("ads/apply.requested");
    expect(inngestEventName("os", "apply.requested")).toBe("ads/apply.requested");
    expect(inngestFunctionId("ads", "apply-requested")).toBe("ads-apply-requested");
    expect(inngestFunctionId("os", "apply-requested")).toBe("ads-apply-requested");
  });

  it("keeps one-release legacy aliases for in-flight os/* and platform-prefixed jobs", () => {
    expect(LEGACY_ADS_EVENTS.applyRequested).toBe("os/apply.requested");
    expect(LEGACY_ADS_EVENTS.auditRequested).toBe("os/audit.requested");
    expect(LEGACY_ADS_EVENTS.metaAdsAccountSync).toBe("meta/ads/account.sync");
    expect(LEGACY_ADS_EVENTS.googleAdsAccountSync).toBe("google/ads/account.sync");
    expect(LEGACY_ADS_FUNCTION_IDS.applyRequested).toBe("os-apply-requested");
    expect(LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync).toBe("meta-ads-account-sync");
    expect(LEGACY_EVENTS.metaAdsAccountSync).toBe("meta/ads/account.sync");
    expect(ADS_FUNCTION_IDS.accountSync).toBe("ads-account-sync");
  });

  it("quarantines Neon schema os behind ADS_DB_SCHEMA without renaming it", () => {
    expect(ADS_DB_SCHEMA).toBe("os");
    expect(OS_DB_SCHEMA).toBe("os");
    expect(OS_DB_SCHEMA).toBe(ADS_DB_SCHEMA);
  });
});
