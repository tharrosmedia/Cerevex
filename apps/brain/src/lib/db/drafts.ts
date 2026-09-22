import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function saveDraft({ jobId, storeId, title, handle, bodyHtml, metaTitle, metaDescription, metafields, schemaJsonLd, rawResearch, evaluationScores, selectedProducts, collectionRules, brief }: { jobId?: string; storeId: string; title: string; handle: string; bodyHtml: string; metaTitle?: string; metaDescription?: string; metafields?: any; schemaJsonLd?: any; rawResearch?: any; evaluationScores?: any; selectedProducts?: any; collectionRules?: any; brief?: any }) {
  const sql = neon(process.env.DATABASE_URL!);
  const mf = toSafeJsonb(metafields, 'metafields');
  const sch = toSafeJsonb(schemaJsonLd, 'schemaJsonLd');
  const rr = toSafeJsonb(rawResearch, 'rawResearch');
  const es = toSafeJsonb(evaluationScores, 'evaluationScores');
  let sel = toSafeJsonb(selectedProducts, 'selectedProducts');
  let cr = toSafeJsonb(collectionRules, 'collectionRules');
  const br = toSafeJsonb(brief, 'brief');
  if (!Array.isArray(sel)) sel = null;
  if (!Array.isArray(cr)) cr = null;
  const result = await sql`INSERT INTO drafts (job_id, store_id, title, handle, body_html, meta_title, meta_description, metafields, schema_jsonld, raw_research, evaluation_scores, selected_products, collection_rules, brief) VALUES (${jobId || null}, ${storeId}, ${title}, ${handle}, ${bodyHtml}, ${metaTitle || null}, ${metaDescription || null}, ${mf}, ${sch}, ${rr}, ${es}, ${sel}, ${cr}, ${br}) RETURNING id, job_id as "jobId", store_id as "storeId", title, handle, body_html as "bodyHtml", meta_title as "metaTitle", meta_description as "metaDescription", metafields, schema_jsonld as "schemaJsonLd", raw_research as "rawResearch", evaluation_scores as "evaluationScores", selected_products as "selectedProducts", collection_rules as "collectionRules", brief, created_at as "createdAt"`;
  return result[0];
}

export async function getDraft(draftId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, job_id as "jobId", store_id as "storeId", title, handle, body_html as "bodyHtml", meta_title as "metaTitle", meta_description as "metaDescription", metafields, schema_jsonld as "schemaJsonLd", raw_research as "rawResearch", evaluation_scores as "evaluationScores", selected_products as "selectedProducts", collection_rules as "collectionRules", brief, created_at as "createdAt" FROM drafts WHERE id = ${draftId}`;
  return result[0];
}

export async function getDraftByJobId(jobId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, job_id as "jobId", store_id as "storeId", title, handle, body_html as "bodyHtml", meta_title as "metaTitle", meta_description as "metaDescription", metafields, schema_jsonld as "schemaJsonLd", evaluation_scores as "evaluationScores", selected_products as "selectedProducts", collection_rules as "collectionRules", brief, created_at as "createdAt" FROM drafts WHERE job_id = ${jobId} ORDER BY created_at DESC LIMIT 1`;
  return result[0];
}

export async function listDrafts(storeId: string, status?: string, limit: number = 50) {
  const sql = neon(process.env.DATABASE_URL!);
  if (status) {
    return sql`SELECT d.id, d.job_id as "jobId", d.store_id as "storeId", d.title, d.handle, d.body_html as "bodyHtml", d.meta_title as "metaTitle", d.meta_description as "metaDescription", d.metafields, d.schema_jsonld as "schemaJsonLd", d.evaluation_scores as "evaluationScores", d.selected_products as "selectedProducts", d.collection_rules as "collectionRules", d.brief, d.created_at as "createdAt", j.status as "jobStatus", j.type as "type" FROM drafts d LEFT JOIN jobs j ON d.job_id = j.id WHERE d.store_id = ${storeId} AND j.status = ${status} ORDER BY d.created_at DESC LIMIT ${limit}`;
  }
  return sql`SELECT d.id, d.job_id as "jobId", d.store_id as "storeId", d.title, d.handle, d.body_html as "bodyHtml", d.meta_title as "metaTitle", d.meta_description as "metaDescription", d.metafields, d.schema_jsonld as "schemaJsonLd", d.evaluation_scores as "evaluationScores", d.selected_products as "selectedProducts", d.collection_rules as "collectionRules", d.brief, d.created_at as "createdAt", j.status as "jobStatus", j.type as "type" FROM drafts d LEFT JOIN jobs j ON d.job_id = j.id WHERE d.store_id = ${storeId} ORDER BY d.created_at DESC LIMIT ${limit}`;
}

export async function updateDraft(draftId: string, updates: Partial<{ title: string; handle: string; bodyHtml: string; metaTitle: string; metaDescription: string; metafields: any; schemaJsonLd: any; selectedProducts?: any; collectionRules?: any; brief?: any }>) {
  const sql = neon(process.env.DATABASE_URL!);
  const sets: string[] = [];
  const values: any[] = [];
  if (updates.title) { sets.push('title = $' + (values.length + 1)); values.push(updates.title); }
  if (updates.handle) { sets.push('handle = $' + (values.length + 1)); values.push(updates.handle); }
  if (updates.bodyHtml) { sets.push('body_html = $' + (values.length + 1)); values.push(updates.bodyHtml); }
  if (updates.metaTitle) { sets.push('meta_title = $' + (values.length + 1)); values.push(updates.metaTitle); }
  if (updates.metaDescription) { sets.push('meta_description = $' + (values.length + 1)); values.push(updates.metaDescription); }
  if (updates.metafields !== undefined) { sets.push('metafields = $' + (values.length + 1)); values.push(toSafeJsonb(updates.metafields, 'metafields')); }
  if (updates.schemaJsonLd !== undefined) { sets.push('schema_jsonld = $' + (values.length + 1)); values.push(toSafeJsonb(updates.schemaJsonLd, 'schemaJsonLd')); }
  if (updates.selectedProducts !== undefined) { const s = toSafeJsonb(updates.selectedProducts, 'selectedProducts'); sets.push('selected_products = $' + (values.length + 1)); values.push(Array.isArray(s) ? s : null); }
  if (updates.collectionRules !== undefined) { const c = toSafeJsonb(updates.collectionRules, 'collectionRules'); sets.push('collection_rules = $' + (values.length + 1)); values.push(Array.isArray(c) ? c : null); }
  if (updates.brief !== undefined) { sets.push('brief = $' + (values.length + 1)); values.push(toSafeJsonb(updates.brief, 'brief')); }
  if (sets.length === 0) return;
  const setClause = sets.join(', ');
  const q = `UPDATE drafts SET ${setClause} WHERE id = $${values.length + 1}`;
  values.push(draftId);
  await sql.query(q, values);
}
