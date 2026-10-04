import { isProductionRuntime } from '@/lib/runtime-env';
import { productionSecretProblems } from '@/lib/prod-secrets';

export const dynamic = 'force-dynamic';

/** Railway healthcheck target after merge. Non-200 when a required production secret is missing or invalid. */
export async function GET() {
  const production = isProductionRuntime();
  const problems = productionSecretProblems();
  const ok = problems.length === 0;
  return Response.json({ ok, production, problems }, { status: ok ? 200 : 503 });
}
