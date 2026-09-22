CREATE TABLE IF NOT EXISTS seo_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  catalog_id uuid,
  shopify_id text,
  handle text,
  resource_type text,
  kind text NOT NULL,
  severity text NOT NULL,
  title text,
  detail jsonb,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_findings_store ON seo_findings(store_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON seo_findings(store_id, status);

-- best-effort dedupe on open
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_open_finding') THEN
    CREATE UNIQUE INDEX uniq_open_finding ON seo_findings (store_id, COALESCE(shopify_id, ''), kind) WHERE status = 'open';
  END IF;
END $$;
