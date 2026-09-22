import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from '../db/safe-json';

export async function logEvent(storeId: string, actor: string, action: string, payload: Record<string, unknown> = {}, jobId?: string): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  const safePayload = toSafeJsonb(payload, 'event.payload');
  await sql`INSERT INTO events (store_id, job_id, actor, action, payload) VALUES (${storeId}, ${jobId || null}, ${actor}, ${action}, ${safePayload})`;
}

export async function listEventsByJob(jobId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, store_id as "storeId", job_id as "jobId", actor, action, payload, created_at as "createdAt" FROM events WHERE job_id = ${jobId} ORDER BY created_at ASC`;
  return result;
}
