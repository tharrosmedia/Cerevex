import {
  JWT_LOCAL_FALLBACK,
  LOCAL_DEV_TOKEN_KEY,
  isProductionRuntime,
  opsEnvRequiredInProduction,
  signingSecretProblem,
  type OpsEnvEntry,
} from "@cerevex/contracts";

const SIGNING_PLACEHOLDERS: Record<string, readonly string[]> = {
  JWT_SECRET: [JWT_LOCAL_FALLBACK],
  TOKEN_ENCRYPTION_KEY: [LOCAL_DEV_TOKEN_KEY],
};

/**
 * Ads production boot.
 * ads-api requires JWT_SECRET and TOKEN_ENCRYPTION_KEY.
 * ads-workers require TOKEN_ENCRYPTION_KEY only. Workers never read JWT_SECRET.
 * TOKEN_ENCRYPTION_KEY with leading or trailing whitespace fails closed. The raw value is not trimmed.
 */
export function adsProductionSecretProblems(entries: readonly OpsEnvEntry[]): string[] {
  if (!isProductionRuntime()) return [];
  const problems: string[] = [];
  for (const entry of entries) {
    const raw = process.env[entry.env] ?? "";
    if (entry.env === "TOKEN_ENCRYPTION_KEY" && raw !== "" && raw !== raw.trim()) {
      problems.push(`${entry.env}:whitespace`);
      continue;
    }
    const placeholders = SIGNING_PLACEHOLDERS[entry.env];
    if (placeholders) {
      const problem = signingSecretProblem(raw, placeholders);
      if (problem) problems.push(`${entry.env}:${problem}`);
      continue;
    }
    if (!raw.trim()) problems.push(`${entry.env}:missing`);
  }
  return problems;
}

function assertEntries(entries: readonly OpsEnvEntry[]): void {
  const problems = adsProductionSecretProblems(entries);
  if (!problems.length) return;
  throw new Error(
    `Required production secrets are missing or invalid (${problems.join(", ")}). Refusing to boot.`,
  );
}

export function assertAdsApiProductionSecrets(
  entries: readonly OpsEnvEntry[] = opsEnvRequiredInProduction("ads-api"),
): void {
  assertEntries(entries);
}

export function assertAdsWorkerProductionSecrets(
  entries: readonly OpsEnvEntry[] = opsEnvRequiredInProduction("ads-workers"),
): void {
  assertEntries(entries);
}
