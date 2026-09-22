/**
 * Tenancy contracts (Plan 1.5).
 *
 * Client 1→N Store via store_id.
 * AdAccounts hang off Client, not store_id.
 *
 * These types are the shared shape for a follow-up OS import.
 * Brain Stage A remains store_id-scoped and does not yet persist Client rows.
 */

export type ClientId = string;
export type StoreId = string;
export type AdAccountId = string;

/** Tenant. Owns stores and ad accounts. */
export interface Client {
  id: ClientId;
  name: string;
  createdAt?: string;
}

/**
 * Shopify (or other) store belonging to a Client.
 * Brain jobs, drafts, events, and catalog rows stay scoped by `id` (store_id).
 */
export interface Store {
  id: StoreId;
  clientId: ClientId;
  name: string;
  shopifyDomain?: string;
  platform?: string;
}

export type AdPlatform = "meta" | "google";

/**
 * Paid-media account. Belongs to Client — never to a single store_id.
 * A client may have many stores and many ad accounts; they are not 1:1.
 */
export interface AdAccount {
  id: AdAccountId;
  clientId: ClientId;
  platform: AdPlatform;
  externalAccountId: string;
  name?: string;
}
