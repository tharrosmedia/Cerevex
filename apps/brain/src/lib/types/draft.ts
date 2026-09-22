export interface CatalogDraft {
  title: string;
  handle: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  metafields?: Record<string, unknown> | Array<{ namespace: string; key: string; type: string; value: string }>;
  schemaJsonLd?: Record<string, unknown>;
  evaluationScores?: any;
  selectedProducts?: Array<{ shopifyId: string; title?: string; handle?: string; imageUrl?: string }>;
  collectionRules?: any[];
  collectionStrategy?: 'manual' | 'rules';
  brief?: any;
}
