/**
 * Connector identity catalog. Runtime interfaces live in @tharros/ads-shared/connectors.
 * Meta/Google/mock implement AdPlatformConnector. CallRail is the M5.2 connect path.
 * Bundled is the Twilio-class lean add-on. Clarity is the analytics/session path.
 * HCP is recommend+join only. Site (WordPress) is stub — no LP mutation in v0.
 */

export const CONNECTOR_KINDS = ["ad_platform", "analytics", "call_tracking", "crm", "site"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const AD_PLATFORM_CONNECTOR_IDS = ["meta", "google", "mock"] as const;
export type AdPlatformConnectorId = (typeof AD_PLATFORM_CONNECTOR_IDS)[number];

export const ANALYTICS_CONNECTOR_IDS = ["ga4", "first_party", "clarity"] as const;
export type AnalyticsConnectorId = (typeof ANALYTICS_CONNECTOR_IDS)[number];

export const CALL_TRACKING_CONNECTOR_IDS = ["callrail", "bundled"] as const;
export type CallTrackingConnectorId = (typeof CALL_TRACKING_CONNECTOR_IDS)[number];

export const CRM_CONNECTOR_IDS = ["hcp"] as const;
export type CrmConnectorId = (typeof CRM_CONNECTOR_IDS)[number];

export const SITE_CONNECTOR_IDS = ["wordpress"] as const;
export type SiteConnectorId = (typeof SITE_CONNECTOR_IDS)[number];

export type ConnectorId =
  | AdPlatformConnectorId
  | AnalyticsConnectorId
  | CallTrackingConnectorId
  | CrmConnectorId
  | SiteConnectorId;

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
    implementation: "live",
    help: "CallTrackingConnector connect path. API key or mock. No unsupervised writes.",
  },
  {
    kind: "call_tracking",
    id: "bundled",
    label: "Bundled call tracking",
    implementation: "live",
    help: "Twilio-class lean CallTrackingConnector. Mock or env/encrypted credentials. No number purchase or routing writes.",
  },
  {
    kind: "crm",
    id: "hcp",
    label: "Housecall Pro",
    implementation: "stub",
    help: "Soft CRM join for booked-job status. Recommend + join only. No write-backs.",
  },
  {
    kind: "analytics",
    id: "clarity",
    label: "Microsoft Clarity",
    implementation: "live",
    help: "Connect Clarity for aggregated heatmap and session signals. No in-house recorder. No raw PII dump.",
  },
  {
    kind: "site",
    id: "wordpress",
    label: "WordPress / Site",
    implementation: "stub",
    help: "Landing-page apply when a Site connector can mutate. v0 is recommend-only — Site apply later.",
  },
];
