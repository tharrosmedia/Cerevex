/**
 * Stable Site / CMS connector interface (WordPress Brief 1.0).
 * Shopify and WordPress are implementations. Runtime packages live in
 * connectors/shopify and connectors/wordpress.
 *
 * UI never writes the CMS. Approve → Inngest job → connector.apply.
 */

export const STORE_CONNECTOR_TYPES = ["shopify", "wordpress"] as const;
export type StoreConnectorType = (typeof STORE_CONNECTOR_TYPES)[number];

export const SITE_CMS_RESOURCE_TYPES = ["post", "page"] as const;
export type SiteCmsResourceType = (typeof SITE_CMS_RESOURCE_TYPES)[number];

export const SITE_CMS_ERROR_CODES = [
  "capability_off",
  "bad_auth",
  "plugin_down",
  "plugin_not_found",
  "unreachable",
  "unsigned",
  "unapproved",
  "kill_switch",
  "unsupported_field",
  "invalid_payload",
  "not_configured",
] as const;
export type SiteCmsErrorCode = (typeof SITE_CMS_ERROR_CODES)[number];

export type SiteCmsEntity = {
  externalId: string;
  resourceType: SiteCmsResourceType;
  handle: string;
  title: string;
  bodyHtml: string;
  seoTitle?: string;
  seoDescription?: string;
  published?: boolean;
  updatedAt?: string;
};

export type SiteCmsHealth = {
  ok: boolean;
  code?: SiteCmsErrorCode;
  reason?: string;
  pluginVersion?: string;
  siteUrl?: string;
};

export type SiteCmsListResult = {
  ok: boolean;
  items: SiteCmsEntity[];
  code?: SiteCmsErrorCode;
  reason?: string;
};

export type SiteCmsApplyPayload = {
  approved: true;
  approvalId: string;
  approvedAt: string;
  storeId: string;
  externalId: string;
  resourceType: SiteCmsResourceType;
  title?: string;
  bodyHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
};

export type SiteCmsApplyResult = {
  ok: boolean;
  writes: boolean;
  code?: SiteCmsErrorCode;
  reason?: string;
  externalId?: string;
  before?: { title?: string; seoTitle?: string; seoDescription?: string };
  after?: { title?: string; seoTitle?: string; seoDescription?: string };
};

export type SiteCmsConnectorId = StoreConnectorType;

/**
 * Shared Site/CMS surface. Implementations must never throw on read/health
 * for missing plugin, bad auth, or flag-off — return a structured result.
 */
export interface SiteCmsConnector {
  readonly id: SiteCmsConnectorId;
  readonly connectorType: StoreConnectorType;
  health(): Promise<SiteCmsHealth>;
  listContent(input?: { resourceType?: SiteCmsResourceType }): Promise<SiteCmsListResult>;
  apply(payload: SiteCmsApplyPayload): Promise<SiteCmsApplyResult>;
}

export function isStoreConnectorType(value: unknown): value is StoreConnectorType {
  return typeof value === "string" && (STORE_CONNECTOR_TYPES as readonly string[]).includes(value);
}

export function isSiteCmsResourceType(value: unknown): value is SiteCmsResourceType {
  return typeof value === "string" && (SITE_CMS_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function wordpressCatalogResourceType(resourceType: SiteCmsResourceType): string {
  return resourceType === "page" ? "wp_page" : "wp_post";
}

export function parseWordpressCatalogResourceType(value: string | null | undefined): SiteCmsResourceType | null {
  if (value === "wp_page" || value === "page") return "page";
  if (value === "wp_post" || value === "post") return "post";
  return null;
}

export function wordpressExternalCatalogId(resourceType: SiteCmsResourceType, externalId: string): string {
  return `wp:${resourceType}:${externalId}`;
}

export function parseWordpressExternalCatalogId(shopifyId: string): { resourceType: SiteCmsResourceType; externalId: string } | null {
  const match = /^wp:(post|page):(.+)$/.exec(shopifyId);
  if (!match) return null;
  return { resourceType: match[1] as SiteCmsResourceType, externalId: match[2] };
}

export const SITE_CMS_PLAIN_ERRORS: Record<SiteCmsErrorCode, string> = {
  capability_off: "WordPress is off for this workspace.",
  bad_auth: "The plugin key was not accepted.",
  plugin_down: "Couldn't reach the site.",
  plugin_not_found: "Plugin not found.",
  unreachable: "Couldn't reach the site.",
  unsigned: "The site rejected an unsigned change. Nothing was written.",
  unapproved: "The site rejected an unapproved change. Nothing was written.",
  kill_switch: "WordPress writes are blocked for this store.",
  unsupported_field: "Only title, body, and meta can be changed.",
  invalid_payload: "That change is not valid.",
  not_configured: "WordPress is not connected yet.",
};

export function siteCmsPlainError(code?: SiteCmsErrorCode, fallback?: string): string {
  if (code && SITE_CMS_PLAIN_ERRORS[code]) return SITE_CMS_PLAIN_ERRORS[code];
  return fallback || "Couldn't complete that WordPress step.";
}
