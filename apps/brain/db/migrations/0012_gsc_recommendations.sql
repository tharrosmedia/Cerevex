ALTER TABLE seo_findings ADD COLUMN IF NOT EXISTS cluster_key text;
ALTER TABLE seo_findings ADD COLUMN IF NOT EXISTS score double precision;
ALTER TABLE seo_findings ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_findings_gsc_source ON seo_findings (store_id, source, status);
CREATE INDEX IF NOT EXISTS idx_findings_gsc_kind ON seo_findings (store_id, kind, status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_gsc_finding
  ON seo_findings (store_id, kind, COALESCE(cluster_key, ''))
  WHERE status = 'open' AND kind IN ('gsc_u', 'gsc_n', 'gsc_c', 'gsc_a');
