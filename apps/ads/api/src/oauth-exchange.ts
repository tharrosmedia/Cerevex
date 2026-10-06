import type { Platform } from "@tharros/ads-shared";
import {
  META_CONNECT_EXTEND_FAILED,
  META_CONNECT_INCOMPLETE,
  getAdPlatformConnector,
} from "@tharros/ads-shared/connectors";

/**
 * Live token exchange. Meta/Google branches live on the connector
 * implementations; this file only dispatches through the registry.
 * A Meta failure stays a plain sentence. The callback saves nothing until this resolves.
 */
export async function exchangeCode(platform: Platform, code: string) {
  try {
    return await getAdPlatformConnector(platform).exchangeCode(code);
  } catch (error) {
    if (platform !== "meta") throw error;
    if (
      error instanceof Error &&
      (error.message === META_CONNECT_INCOMPLETE || error.message === META_CONNECT_EXTEND_FAILED)
    ) {
      throw error;
    }
    throw new Error(META_CONNECT_EXTEND_FAILED);
  }
}
