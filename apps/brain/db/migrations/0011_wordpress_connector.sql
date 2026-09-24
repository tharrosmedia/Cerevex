-- WordPress is a store/site connector type (Architecture 1.0).
-- Existing Shopify rows stay shopify. Disconnect must not delete audit/events.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS connector_type text;
UPDATE stores SET connector_type = COALESCE(NULLIF(connector_type, ''), COALESCE(platform, 'shopify'));
ALTER TABLE stores ALTER COLUMN connector_type SET DEFAULT 'shopify';

ALTER TABLE catalog_resources ADD COLUMN IF NOT EXISTS connector_type text DEFAULT 'shopify';
ALTER TABLE catalog_resources ADD COLUMN IF NOT EXISTS external_id text;
UPDATE catalog_resources SET external_id = shopify_id WHERE external_id IS NULL;
UPDATE catalog_resources SET connector_type = COALESCE(NULLIF(connector_type, ''), 'shopify');
