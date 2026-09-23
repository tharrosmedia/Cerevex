/**
 * Site connector stub (M5.2 Phase C).
 * v0 does not mutate WordPress / Multi-CMS. LP recs stay Site apply later.
 */

import type { ConnectorConnectInput, ConnectorConnectResult, SiteConnector } from "./types";

class WordPressSiteConnector implements SiteConnector {
  readonly kind = "site" as const;
  readonly implementation = "stub" as const;
  readonly id = "wordpress" as const;
  readonly label = "WordPress / Site";
  readonly supportsLandingPageMutation = false as const;
  readonly connectCapability = undefined;

  isConfigured(): boolean {
    return false;
  }

  async connect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: false,
      stub: true,
      mock: false,
      connectorId: this.id,
      reason: "Site apply is not staffed in this slice. LP intelligence stays recommend-only — Site apply later.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: true,
      connectorId: this.id,
      reason: "No Site connection to clear. Nothing was written.",
    };
  }
}

export const wordPressSiteConnector = new WordPressSiteConnector();

export function getDefaultSiteConnector(): SiteConnector {
  return wordPressSiteConnector;
}
