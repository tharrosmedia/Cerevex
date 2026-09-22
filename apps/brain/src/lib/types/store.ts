import type { SEORule } from '../seo/rules';

export interface MetafieldTarget {
  namespace: string;
  key: string;
  type?: string;
}

export interface Placement {
  body?: {
    target: 'main' | 'metafield';
    metafield?: MetafieldTarget;
    populateMain?: boolean;
  };
  metafields?: Array<{
    source: string;
    target: MetafieldTarget;
  }>;
  products?: {
    mode?: 'manual' | 'rules';
    auto?: boolean;
    maxProducts?: number;
  };
}

export interface BrandVoice {
  text: string;
  allowedClaims?: string[];
  forbiddenClaims?: string[];
  inferredAt?: string;
  samplesUsed?: number;
}

export interface Autonomy {
  allowedTypes?: Array<'collection' | 'page' | 'blog'>;
  requireApproval?: boolean;
}

export interface StoreConfig {
  placement?: Record<string, Placement>;
  brandVoice?: BrandVoice;
  autonomy?: Autonomy;
  metafieldSchema?: {
    definitions?: any[];
    samples?: any;
    lastRefreshed?: string;
  };
  productsLastSynced?: string;
  productsSyncedCount?: number;
  catalogLastSynced?: string;
  catalogSyncedCount?: number;
  seoRules?: SEORule[];
  gsc?: {
    propertyUrl?: string;
    refreshTokenEnc?: string;
    connectedAt?: string;
    lastSyncedAt?: string;
  };
}

export interface Store {
  id: string;
  name: string;
  shopifyDomain: string;
  platform?: string;
  config?: StoreConfig;
}
