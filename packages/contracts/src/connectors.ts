/**
 * Connector identity catalog. Runtime interfaces live in @tharros/ads-shared/connectors.
 * Meta/Google/mock implement AdPlatformConnector. GA4 + CallRail are stubs that
 * compile against the same Connector contract.
 */

export const CONNECTOR_KINDS = ["ad_platform", "analytics", "call_tracking"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const AD_PLATFORM_CONNECTOR_IDS = ["meta", "google", "mock"] as const;
export type AdPlatformConnectorId = (typeof AD_PLATFORM_CONNECTOR_IDS)[number];

export const ANALYTICS_CONNECTOR_IDS = ["ga4", "first_party"] as const;
export type AnalyticsConnectorId = (typeof ANALYTICS_CONNECTOR_IDS)[number];

export const CALL_TRACKING_CONNECTOR_IDS = ["callrail", "bundled"] as const;
export type CallTrackingConnectorId = (typeof CALL_TRACKING_CONNECTOR_IDS)[number];

export type ConnectorId = AdPlatformConnectorId | AnalyticsConnectorId | CallTrackingConnectorId;

export type ConnectorImplementation = "live" | "mock" | "stub";

export type ConnectorCatalogEntry = {
  kind: ConnectorKind;
  id: ConnectorId;
  label: string;
  implementation: ConnectorImplementation;
  help: string;
};

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    kind: "ad_platform",
    id: "meta",
    label: "Meta Ads",
    implementation: "live",
    help: "Existing Meta OAuth + pull. Writes stay behind Approve.",
  },
  {
    kind: "ad_platform",
    id: "google",
    label: "Google Ads",
    implementation: "live",
    help: "Existing Google OAuth + pull. Writes stay behind Approve.",
  },
  {
    kind: "ad_platform",
    id: "mock",
    label: "Mock ads",
    implementation: "mock",
    help: "Local/CI implementation of AdPlatformConnector. Same interface as Meta/Google.",
  },
  {
    kind: "analytics",
    id: "ga4",
    label: "GA4",
    implementation: "live",
    help: "Connect a GA4 property. Aggregated conversions can strengthen recs. No user-level export.",
  },
  {
    kind: "analytics",
    id: "first_party",
    label: "First-party events",
    implementation: "live",
    help: "Cerevex pixel for ad → landing page → lead. No session replay or heatmaps.",
  },
  {
    kind: "call_tracking",
    id: "callrail",
    label: "CallRail",
    implementation: "stub",
    help: "Stub CallTrackingConnector (connect). No CallRail product work.",
  },
  {
    kind: "call_tracking",
    id: "bundled",
    label: "Bundled call tracking",
    implementation: "stub",
    help: "Stub CallTrackingConnector (bundled). No telephony product work.",
  },
];
