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

export const USAGE_COUNT_FAILED_MESSAGE = 'SEO job was saved but the monthly count was not recorded';
export const AMBIGUOUS_STORE_USAGE_MESSAGE =
  'SEO job was saved but the monthly count was skipped because the store matches more than one client';

/** A SQLSTATE or node error code. Free text can carry a host, token, or password. */
export function usageErrorCode(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return 'unknown';
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
 * must not stop an internal job from being saved. A store that matches two
 * clients is not charged. The report is a fixed sentence plus a code, never
 * the error text.
 */
async function countSeoJob(storeId: string, itemId: string) {
  try {
    const { recordUsageForStore } = await import('@tharros/ads-shared/usage');
    const recorded = await recordUsageForStore({
      storeId,
      kind: 'seo_jobs',
      itemId,
      outcome: 'created',
    });
    if ('skipped' in recorded && recorded.reason === 'ambiguous_client') {
      console.error('[usage]', AMBIGUOUS_STORE_USAGE_MESSAGE, storeId);
      try {
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureMessage(AMBIGUOUS_STORE_USAGE_MESSAGE, {
          level: 'error',
          tags: { area: 'monthly-usage' },
          extra: { storeId },
        });
      } catch {
        // A local run without the Sentry package still keeps the job.
      }
    }
  } catch (error) {
    const code = usageErrorCode(error);
    console.error('[usage]', USAGE_COUNT_FAILED_MESSAGE, code);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureMessage(USAGE_COUNT_FAILED_MESSAGE, {
        level: 'error',
        tags: { area: 'monthly-usage' },
        extra: { code },
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
