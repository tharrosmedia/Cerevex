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
 * Ads production boot. Uses OpsEnvEntry.requiredInProduction === "ads".
 * JWT_SECRET and TOKEN_ENCRYPTION_KEY also reject a short value and the .env.example placeholder in any case.
 */
export function adsProductionSecretProblems(
  entries: readonly OpsEnvEntry[] = opsEnvRequiredInProduction("ads"),
): string[] {
  if (!isProductionRuntime()) return [];
  const problems: string[] = [];
  for (const entry of entries) {
    const placeholders = SIGNING_PLACEHOLDERS[entry.env];
    if (placeholders) {
      const problem = signingSecretProblem(process.env[entry.env], placeholders);
      if (problem) problems.push(`${entry.env}:${problem}`);
      continue;
    }
    if (!(process.env[entry.env] ?? "").trim()) problems.push(`${entry.env}:missing`);
  }
  return problems;
}

export function assertAdsProductionSecrets(entries?: readonly OpsEnvEntry[]): void {
  const problems = adsProductionSecretProblems(entries);
  if (!problems.length) return;
  throw new Error(
    `Required production secrets are missing or invalid (${problems.join(", ")}). Refusing to boot.`,
  );
}
