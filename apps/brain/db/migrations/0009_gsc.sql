CREATE TABLE IF NOT EXISTS gsc_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  date_start date,
  date_end date,
  query text,
  page text,
  clicks int,
  impressions int,
  ctr double precision,
  position double precision,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gsc_store ON gsc_rows(store_id);
CREATE INDEX IF NOT EXISTS idx_gsc_date ON gsc_rows(store_id, date_end);
