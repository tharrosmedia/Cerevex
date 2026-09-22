/**
 * Shared tenancy envelopes.
 *
 * Product lock — Client ↔ store_id:
 * - One Client maps to N Shopify stores (`store_id`).
 * - OS AdAccounts hang off Client (`clientId`), never `store_id`.
 * - Brain keeps `store_id` keys until a later optional `client_id` backfill.
 */

export type WorkspaceId = string;
export type ClientId = string;
export type StoreId = string;
export type AdAccountId = string;
export type AdPlatform = "meta" | "google";

export type Workspace = {
  id: WorkspaceId;
  name: string;
  /** OS apply kill switch. Brain publish paths should treat this as a hard stop. */
  applyKillSwitch: boolean;
  settingsJson?: Record<string, unknown>;
  createdAt: string;
};

/**
 * OS Client. Does not own a single `storeId` column — the Client→Store
 * relation is 1→N via `ClientStoreLink`.
 */
export type Client = {
  id: ClientId;
  workspaceId: WorkspaceId;
  name: string;
  status: string;
  pilotFlag?: boolean;
  createdAt: string;
};

/**
 * One Shopify store. Brain rows stay keyed by `storeId` / `id` until an optional
 * later `clientId` backfill. `clientId` is therefore nullable here.
 */
export type Store = {
  storeId: StoreId;
  /** Alias used by existing Brain rows (`stores.id`). */
  id?: StoreId;
  clientId?: ClientId | null;
  workspaceId?: WorkspaceId | null;
  name?: string;
  shopifyDomain?: string;
  platform?: string;
};

/**
 * Client 1→N Store. One HVAC/home-service client may own several Shopify
 * stores. A store belongs to at most one client.
 */
export type ClientStoreLink = {
  clientId: ClientId;
  storeId: StoreId;
  workspaceId: WorkspaceId;
};

/**
 * OS AdAccount hangs off Client, not `store_id`.
 * Do not add `storeId` to this envelope.
 */
export type AdAccount = {
  id: AdAccountId;
  workspaceId?: WorkspaceId;
  clientId: ClientId;
  platform: AdPlatform;
  externalId: string;
  /** Brain-facing alias for externalId. */
  externalAccountId?: string;
  connectionStatus?: string;
  name?: string;
};
