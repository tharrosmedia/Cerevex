import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function saveApproval({ jobId, storeId, status, reviewerNotes, editedPayload }: { jobId?: string; storeId: string; status: string; reviewerNotes?: string; editedPayload?: any }) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeEdited = toSafeJsonb(editedPayload, 'approval.editedPayload');
  const result = await sql`INSERT INTO approvals (job_id, store_id, status, reviewer_notes, edited_payload, decided_at) VALUES (${jobId || null}, ${storeId}, ${status}, ${reviewerNotes || null}, ${safeEdited}, now()) RETURNING id, job_id as "jobId", store_id as "storeId", status, reviewer_notes as "reviewerNotes", edited_payload as "editedPayload", decided_at as "decidedAt"`;
  return result[0];
}

export async function getApprovalByJobId(jobId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, job_id as "jobId", store_id as "storeId", status, reviewer_notes as "reviewerNotes", edited_payload as "editedPayload", decided_at as "decidedAt" FROM approvals WHERE job_id = ${jobId} ORDER BY decided_at DESC LIMIT 1`;
  return result[0];
}

export async function listApprovalsByJob(jobId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, job_id as "jobId", store_id as "storeId", status, reviewer_notes as "reviewerNotes", edited_payload as "editedPayload", decided_at as "decidedAt" FROM approvals WHERE job_id = ${jobId} ORDER BY decided_at ASC`;
  return result;
}
