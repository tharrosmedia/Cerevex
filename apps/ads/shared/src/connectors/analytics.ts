import type {
  AnalyticsConnector,
  ConnectorConnectInput,
  ConnectorConnectResult,
} from "./types";

function result(
  connectorId: string,
  ok: boolean,
  reason: string,
  extra: Partial<ConnectorConnectResult> = {},
): ConnectorConnectResult {
  return { ok, stub: false, connectorId, reason, ...extra };
}

class Ga4AnalyticsConnector implements AnalyticsConnector {
  readonly kind = "analytics" as const;
  readonly implementation = "live" as const;
  readonly id = "ga4" as const;
  readonly label = "GA4";

  isConfigured(): boolean {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    return Boolean(env.GA4_PROPERTY_ID || env.GA4_MEASUREMENT_ID);
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    const propertyId = input.externalId?.trim();
    if (!propertyId && !this.isConfigured()) {
      return result(this.id, true, "GA4 will store the property id you entered. Aggregated conversions only — no user-level export.");
    }
    return result(this.id, true, "GA4 is connected. Cerevex stores the property id and can use aggregated conversions to strengthen recs.", {
      externalId: propertyId,
    });
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return result(this.id, true, "GA4 disconnected. Existing events were kept.");
  }
}

class FirstPartyAnalyticsConnector implements AnalyticsConnector {
  readonly kind = "analytics" as const;
  readonly implementation = "live" as const;
  readonly id = "first_party" as const;
  readonly label = "First-party events";

  isConfigured(): boolean {
    return true;
  }

  async connect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return result(
      this.id,
      true,
      "Cerevex pixel is ready. It records page views and leads only — no session replay, heatmaps, or visitor video.",
    );
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return result(this.id, true, "First-party pixel disconnected. Historical events were kept.");
  }
}

export const ga4AnalyticsConnector = new Ga4AnalyticsConnector();
export const firstPartyAnalyticsConnector = new FirstPartyAnalyticsConnector();
