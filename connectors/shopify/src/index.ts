/**
 * Shopify implementation of the shared Site/CMS interface.
 *
 * Live catalog sync and Approve-gated publish stay in apps/brain
 * (`src/lib/shopify`, publisher). This package exists so WordPress and
 * Shopify sit behind the same connector surface.
 */

import type {
  SiteCmsApplyPayload,
  SiteCmsApplyResult,
  SiteCmsConnector,
  SiteCmsHealth,
  SiteCmsListResult,
  SiteCmsResourceType,
} from "@cerevex/contracts";

export class ShopifySiteCmsConnector implements SiteCmsConnector {
  readonly id = "shopify" as const;
  readonly connectorType = "shopify" as const;

  async health(): Promise<SiteCmsHealth> {
    return {
      ok: true,
      reason: "Shopify stays on the Brain Admin API path.",
    };
  }

  async listContent(_input?: { resourceType?: SiteCmsResourceType }): Promise<SiteCmsListResult> {
    return {
      ok: false,
      items: [],
      code: "not_configured",
      reason: "Use Brain catalog sync for Shopify.",
    };
  }

  async apply(_payload: SiteCmsApplyPayload): Promise<SiteCmsApplyResult> {
    return {
      ok: false,
      writes: false,
      code: "unsupported_field",
      reason: "Shopify apply stays Approve-gated on the Brain publisher.",
    };
  }
}

export const shopifySiteConnector = new ShopifySiteCmsConnector();

export function getShopifySiteConnector(): SiteCmsConnector {
  return shopifySiteConnector;
}
