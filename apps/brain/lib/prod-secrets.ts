import { encryptionKeyProblem, isProductionRuntime } from './runtime-env';

/** Brain production boot and /api/health. Names only — values are never returned. */
export const PRODUCTION_SECRET_NAMES = [
  'ENCRYPTION_KEY',
  'GSC_OAUTH_STATE_SECRET',
  'APP_PASSWORD',
  'ADS_INTERNAL_KEY',
] as const;

export type ProductionSecretProblem = `${(typeof PRODUCTION_SECRET_NAMES)[number]}:${'missing' | 'whitespace'}`;

export function productionSecretProblems(): ProductionSecretProblem[] {
  if (!isProductionRuntime()) return [];
  const problems: ProductionSecretProblem[] = [];
  const encryption = encryptionKeyProblem();
  if (encryption) problems.push(`ENCRYPTION_KEY:${encryption}`);
  for (const name of PRODUCTION_SECRET_NAMES) {
    if (name === 'ENCRYPTION_KEY') continue;
    if (!(process.env[name] || '').trim()) problems.push(`${name}:missing`);
  }
  return problems;
}

export function assertProductionSecrets(): void {
  const problems = productionSecretProblems();
  if (!problems.length) return;
  throw new Error(
    `Required production secrets are missing or invalid (${problems.join(', ')}). Refusing to boot.`,
  );
}
