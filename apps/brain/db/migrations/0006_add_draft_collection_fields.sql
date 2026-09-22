ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS selected_products jsonb,
  ADD COLUMN IF NOT EXISTS collection_rules jsonb;
