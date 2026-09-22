CREATE TABLE IF NOT EXISTS catalog_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  shopify_id text NOT NULL,
  resource_type text NOT NULL,
  handle text,
  title text,
  seo_title text,
  seo_description text,
  body_html text,
  metafields jsonb,
  product_count int,
  published boolean,
  shopify_updated_at timestamptz,
  synced_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_catalog_store_shopify' AND conrelid = 'catalog_resources'::regclass
  ) THEN
    ALTER TABLE catalog_resources ADD CONSTRAINT uniq_catalog_store_shopify UNIQUE (store_id, shopify_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catalog_store ON catalog_resources(store_id);
CREATE INDEX IF NOT EXISTS idx_catalog_type ON catalog_resources(store_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_catalog_handle ON catalog_resources(store_id, handle);
