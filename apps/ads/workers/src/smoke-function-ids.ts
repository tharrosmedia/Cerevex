import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADS_FUNCTION_IDS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { FUNCTION_IDS as LEGACY_GOOGLE_IDS } from "@cerevex/jobs-google-ads";
import { FUNCTION_IDS as LEGACY_META_IDS } from "@cerevex/jobs-meta-ads";
import { FUNCTION_IDS, functions } from "./register";

const EXPECTED = [
  ADS_FUNCTION_IDS.stubPing,
  LEGACY_ADS_FUNCTION_IDS.stubPing,
  ADS_FUNCTION_IDS.stubSync,
  LEGACY_ADS_FUNCTION_IDS.stubSync,
  ADS_FUNCTION_IDS.applyRequested,
  LEGACY_ADS_FUNCTION_IDS.applyRequested,
  ADS_FUNCTION_IDS.auditRequested,
  LEGACY_ADS_FUNCTION_IDS.auditRequested,
  ADS_FUNCTION_IDS.accountSync,
  LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync,
  LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync,
] as const;

function readFunctionId(fn: unknown): string {
  if (fn && typeof fn === "object" && "id" in fn) {
    const id = (fn as { id: unknown }).id;
    if (typeof id === "string") return id;
    if (typeof id === "function") return String(id.call(fn));
  }
  throw new Error("Inngest function is missing id");
}

function assertSame(actual: readonly string[], expected: readonly string[], label: string) {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`${label}\n  actual: ${actual.join(", ")}\n  expected: ${expected.join(", ")}`);
  }
}

assertSame([...FUNCTION_IDS], [...EXPECTED], "served function ids drifted");

const unique = new Set(FUNCTION_IDS);
if (unique.size !== FUNCTION_IDS.length) {
  throw new Error(`duplicate served function ids: ${FUNCTION_IDS.join(", ")}`);
}

const registered = functions.map(readFunctionId);
assertSame(registered, [...EXPECTED], "Inngest function objects drifted from FUNCTION_IDS");

assertSame([...LEGACY_META_IDS], [LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync], "legacy meta package ids drifted");
assertSame(
  [...LEGACY_GOOGLE_IDS],
  [LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync],
  "legacy google package ids drifted",
);

const clientSrc = readFileSync(fileURLToPath(new URL("../../shared/src/inngest.ts", import.meta.url)), "utf8");
if (!clientSrc.includes("OS_INNGEST_APP_ID") || !clientSrc.includes('"cerevex-ads"')) {
  throw new Error("ads Inngest client no longer defaults to cerevex-ads via OS_INNGEST_APP_ID");
}

console.log(JSON.stringify({ ok: true, appId: "cerevex-ads", functions: FUNCTION_IDS }, null, 2));
