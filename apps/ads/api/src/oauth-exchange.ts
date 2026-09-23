import type { Platform } from "@tharros/ads-shared";
import { getAdPlatformConnector } from "@tharros/ads-shared/connectors";

/**
 * Live token exchange. Meta/Google branches live on the connector
 * implementations; this file only dispatches through the registry.
 */
export function exchangeCode(platform: Platform, code: string) {
  return getAdPlatformConnector(platform).exchangeCode(code);
}
