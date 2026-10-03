import type { OpsEnvEntry } from '@cerevex/contracts';
import { opsEnvRequiredInProduction } from '@cerevex/contracts';
import { encryptionKeyProblem, isProductionRuntime } from './runtime-env';

/** Brain production boot and /api/health. Names only — values are never returned. */
export const PRODUCTION_SECRET_NAMES = [
  'ENCRYPTION_KEY',
  'GSC_OAUTH_STATE_SECRET',
  'APP_PASSWORD',
  'ADS_INTERNAL_KEY',
] as const;

export type ProductionSecretProblem = `${(typeof PRODUCTION_SECRET_NAMES)[number]}:${'missing' | 'whitespace'}`;

/** Uses OpsEnvEntry.requiredInProduction === "brain". ENCRYPTION_KEY keeps the no-trim whitespace check. */
export function productionSecretProblems(
  entries: readonly OpsEnvEntry[] = opsEnvRequiredInProduction('brain'),
): string[] {
  if (!isProductionRuntime()) return [];
  const problems: string[] = [];
  for (const entry of entries) {
    if (entry.env === 'ENCRYPTION_KEY') {
      const encryption = encryptionKeyProblem();
      if (encryption) problems.push(`ENCRYPTION_KEY:${encryption}`);
      continue;
    }
    if (!(process.env[entry.env] || '').trim()) problems.push(`${entry.env}:missing`);
  }
  return problems;
}

/**
 * Run on server start (`npm run start --workspace=@cerevex/brain`, lifecycle event `start`).
 * Skipped only while `next build` is running, so the production build can compile without the runtime secrets.
 */
export function shouldCheckProductionSecrets(): boolean {
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.npm_lifecycle_event === 'build') return false;
  return true;
}

export function assertProductionSecrets(): void {
  const problems = productionSecretProblems();
  if (!problems.length) return;
  throw new Error(
    `Required production secrets are missing or invalid (${problems.join(', ')}). Refusing to boot.`,
  );
}
