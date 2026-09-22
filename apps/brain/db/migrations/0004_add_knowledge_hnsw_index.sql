CREATE INDEX IF NOT EXISTS idx_knowledge_embedding 
ON knowledge USING hnsw (embedding vector_cosine_ops);
