/**
 * Ad-platform connector barrel. Live Meta/Google branches live in the
 * connector modules — call sites must go through the registry.
 */

export { MetaAdPlatformConnector, metaAdPlatformConnector } from "./meta";
export { GoogleAdPlatformConnector, googleAdPlatformConnector } from "./google";
export { MockAdPlatformConnector, mockAdPlatformConnector } from "./mock";
