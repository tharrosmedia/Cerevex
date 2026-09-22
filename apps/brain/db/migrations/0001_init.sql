CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  shopify_domain text NOT NULL,
  shopify_access_token text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  domain text NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  input jsonb NOT NULL,
  output jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  store_id uuid NOT NULL,
  title text,
  handle text,
  body_html text,
  meta_title text,
  meta_description text,
  metafields jsonb,
  schema_jsonld jsonb,
  raw_research jsonb,
  evaluation_scores jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  store_id uuid NOT NULL,
  status text NOT NULL,
  reviewer_notes text,
  edited_payload jsonb,
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  content text NOT NULL,
  metadata jsonb,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  job_id uuid,
  actor text NOT NULL,
  action text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_store ON jobs(store_id);
CREATE INDEX IF NOT EXISTS idx_drafts_store ON drafts(store_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_store ON knowledge(store_id);
CREATE INDEX IF NOT EXISTS idx_events_store ON events(store_id);
