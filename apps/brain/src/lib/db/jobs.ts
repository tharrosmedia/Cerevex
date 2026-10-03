import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function createJob({ storeId, domain, type, input, status = 'running' }: { storeId: string; domain: string; type: string; input: any; status?: string }) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeInput = toSafeJsonb(input, 'job.input');
  const result = await sql`INSERT INTO jobs (store_id, domain, type, status, input) VALUES (${storeId}, ${domain}, ${type}, ${status}, ${safeInput}) RETURNING id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt"`;
  const job = result[0];
  if (domain === 'seo' && job?.id) {
    await countSeoJob(storeId, String(job.id), job.createdAt);
  }
  return job;
}

/**
 * One SEO job counts once, by job id. A failed count does not undo the job:
 * the cap check is report-only, and a database that has not been migrated yet
 * must not stop an internal job from being saved.
 */
async function countSeoJob(storeId: string, itemId: string, createdAt: unknown) {
  try {
    const { recordUsageForStore } = await import('@tharros/ads-shared/usage');
    const when = createdAt instanceof Date ? createdAt : new Date(typeof createdAt === 'string' ? createdAt : Date.now());
    await recordUsageForStore({
      storeId,
      kind: 'seo_jobs',
      itemId,
      outcome: 'created',
      createdAt: Number.isNaN(when.getTime()) ? new Date() : when,
    });
  } catch (error) {
    console.error('[usage] SEO job was saved but the monthly count was not recorded', error);
  }
}

export async function updateJobStatus(jobId: string, status: string, output?: any) {
  const sql = neon(process.env.DATABASE_URL!);
  if (output !== undefined) {
    const safeOutput = toSafeJsonb(output, 'job.output');
    await sql`UPDATE jobs SET status = ${status}, output = ${safeOutput}, updated_at = now() WHERE id = ${jobId}`;
  } else {
    await sql`UPDATE jobs SET status = ${status}, updated_at = now() WHERE id = ${jobId}`;
  }
}

export async function getJob(jobId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt" FROM jobs WHERE id = ${jobId}`;
  return result[0];
}

export async function listJobs(storeId: string, limit: number = 50) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt" FROM jobs WHERE store_id = ${storeId} ORDER BY created_at DESC LIMIT ${limit}`;
  return result;
}
