/**
 * Node-side connector registry. Do not import this from ads-web client bundles
 * (oauth → loadEnv → node:fs). Types are safe via `./types` / the root barrel.
 */

import { CONNECTOR_CATALOG } from "@cerevex/contracts";
import {
  googleAdPlatformConnector,
  metaAdPlatformConnector,
  mockAdPlatformConnector,
} from "./ad-platform";
import { firstPartyAnalyticsConnector, ga4AnalyticsConnector } from "./analytics";
import { bundledCallTrackingConnector } from "./bundled";
import { callRailConnector } from "./callrail";
import { clarityAnalyticsConnector } from "./clarity";
import { housecallProConnector } from "./crm";
import { wordPressSiteConnector } from "./site";
import type {
  AdPlatformConnector,
  AnalyticsConnector,
  AnyConnector,
  CallTrackingConnector,
  Connector,
  CrmConnector,
  SiteConnector,
} from "./types";

export type {
  AdPlatformConnector,
  AnalyticsConnector,
  AnyConnector,
  CallTrackingConnector,
  Connector,
  ConnectorApplyInput,
  ConnectorConnectInput,
  ConnectorConnectResult,
  ConnectorExchangeResult,
  ConnectorPullInput,
  CrmConnector,
  SiteConnector,
  CallTrackingPullInput,
  CallTrackingPullResult,
  CrmJoinInput,
  CrmJoinResult,
  SessionSignalsPullInput,
  SessionSignalsPullResult,
} from "./types";

export {
  googleAdPlatformConnector,
  metaAdPlatformConnector,
  mockAdPlatformConnector,
  MetaAdPlatformConnector,
  GoogleAdPlatformConnector,
  MockAdPlatformConnector,
} from "./ad-platform";
export { firstPartyAnalyticsConnector, ga4AnalyticsConnector } from "./analytics";
export { bundledCallTrackingConnector, BundledCallTrackingConnector, twilioEnvCredentials } from "./bundled";
export { callRailConnector, CallRailConnector, callRailEnvCredentials } from "./callrail";
export { clarityAnalyticsConnector, ClarityAnalyticsConnector, clarityEnvCredentials, signalsFromClarityInsights } from "./clarity";
export { housecallProConnector } from "./crm";
export { wordPressSiteConnector, getDefaultSiteConnector } from "./site";

export const AD_PLATFORM_CONNECTORS: AdPlatformConnector[] = [
  metaAdPlatformConnector,
  googleAdPlatformConnector,
  mockAdPlatformConnector,
];

export const ANALYTICS_CONNECTORS: AnalyticsConnector[] = [
  ga4AnalyticsConnector,
  firstPartyAnalyticsConnector,
  clarityAnalyticsConnector,
];

export const SITE_CONNECTORS: SiteConnector[] = [wordPressSiteConnector];

export const CALL_TRACKING_CONNECTORS: CallTrackingConnector[] = [
  callRailConnector,
  bundledCallTrackingConnector,
];

export const CRM_CONNECTORS: CrmConnector[] = [housecallProConnector];

export const CONNECTORS: AnyConnector[] = [
  ...AD_PLATFORM_CONNECTORS,
  ...ANALYTICS_CONNECTORS,
  ...CALL_TRACKING_CONNECTORS,
  ...CRM_CONNECTORS,
  ...SITE_CONNECTORS,
];

export function getAdPlatformConnector(id: AdPlatformConnector["id"]): AdPlatformConnector {
  const found = AD_PLATFORM_CONNECTORS.find((connector) => connector.id === id);
  if (!found) throw new Error(`Unknown ad platform connector: ${id}`);
  return found;
}

export function getAnalyticsConnector(id: AnalyticsConnector["id"]): AnalyticsConnector {
  const found = ANALYTICS_CONNECTORS.find((connector) => connector.id === id);
  if (!found) throw new Error(`Unknown analytics connector: ${id}`);
  return found;
}

export function getCallTrackingConnector(id: CallTrackingConnector["id"]): CallTrackingConnector {
  const found = CALL_TRACKING_CONNECTORS.find((connector) => connector.id === id);
  if (!found) throw new Error(`Unknown call-tracking connector: ${id}`);
  return found;
}

export function getCrmConnector(id: CrmConnector["id"]): CrmConnector {
  const found = CRM_CONNECTORS.find((connector) => connector.id === id);
  if (!found) throw new Error(`Unknown CRM connector: ${id}`);
  return found;
}

export function getSiteConnector(id: SiteConnector["id"] = "wordpress"): SiteConnector {
  const found = SITE_CONNECTORS.find((connector) => connector.id === id);
  if (!found) throw new Error(`Unknown Site connector: ${id}`);
  return found;
}

/** Same Connector surface for Meta (live) and CallRail (connect). */
export function asConnector(connector: AnyConnector): Connector {
  return connector;
}

export function connectorCatalog() {
  return CONNECTOR_CATALOG;
}
