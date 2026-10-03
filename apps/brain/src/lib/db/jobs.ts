import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

/** A full SEO run counts. A manual WordPress edit is not that run. */
export function countsAsSeoUsage(domain: string, type: string): boolean {
  return domain === 'seo' && type !== 'seo.wordpress';
}

/** Same id for every retry of one Inngest event, so the count cannot double. */
export function stableUsageJobId(eventId: string): string {
  const hex = createHash('sha256').update(`seo-ensure-job:${eventId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function scrubUsageDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'The monthly count was not recorded.';
  return raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[database]')
    .replace(/(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]')
    .slice(0, 300);
}

export async function createJob({ storeId, domain, type, input, status = 'running', id }: { storeId: string; domain: string; type: string; input: any; status?: string; id?: string }) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeInput = toSafeJsonb(input, 'job.input');
  const inserted = id
    ? await sql`INSERT INTO jobs (id, store_id, domain, type, status, input) VALUES (${id}, ${storeId}, ${domain}, ${type}, ${status}, ${safeInput}) ON CONFLICT (id) DO NOTHING RETURNING id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt"`
    : await sql`INSERT INTO jobs (store_id, domain, type, status, input) VALUES (${storeId}, ${domain}, ${type}, ${status}, ${safeInput}) RETURNING id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt"`;
  const job = inserted[0] ?? (id
    ? (await sql`SELECT id, store_id as "storeId", domain, type, status, input, output, created_at as "createdAt" FROM jobs WHERE id = ${id}`)[0]
    : undefined);
  if (countsAsSeoUsage(domain, type) && job?.id) {
    await countSeoJob(storeId, String(job.id));
  }
  return job;
}

/**
 * One SEO job counts once, by job id. A failed count does not undo the job:
 * the cap check is report-only, and a database that has not been migrated yet
 * must not stop an internal job from being saved. The failure is reported,
 * with the database address and secrets removed.
 */
async function countSeoJob(storeId: string, itemId: string) {
  try {
    const { recordUsageForStore } = await import('@tharros/ads-shared/usage');
    await recordUsageForStore({
      storeId,
      kind: 'seo_jobs',
      itemId,
      outcome: 'created',
    });
  } catch (error) {
    const detail = scrubUsageDetail(error);
    console.error('[usage] SEO job was saved but the monthly count was not recorded', detail);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureMessage('SEO job was saved but the monthly count was not recorded', {
        level: 'error',
        tags: { area: 'monthly-usage' },
        extra: { detail },
      });
    } catch {
      // A local run without the Sentry package still keeps the job.
    }
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
