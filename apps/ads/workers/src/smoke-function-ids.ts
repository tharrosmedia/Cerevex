import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADS_EVENTS, ADS_FUNCTION_IDS, LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
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

const EXPECTED_EVENTS = [
  ADS_EVENTS.stubPing,
  LEGACY_ADS_EVENTS.stubPing,
  ADS_EVENTS.stubSync,
  LEGACY_ADS_EVENTS.stubSync,
  ADS_EVENTS.applyRequested,
  LEGACY_ADS_EVENTS.applyRequested,
  ADS_EVENTS.auditRequested,
  LEGACY_ADS_EVENTS.auditRequested,
  ADS_EVENTS.accountSync,
  LEGACY_ADS_EVENTS.metaAdsAccountSync,
  LEGACY_ADS_EVENTS.googleAdsAccountSync,
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

const events = functions.map((fn) => {
  const triggers = (fn as { opts?: { triggers?: { event?: string }[] } }).opts?.triggers ?? [];
  const event = triggers[0]?.event;
  if (!event || triggers.length !== 1) throw new Error(`${readFunctionId(fn)} must listen to exactly one event`);
  return event;
});
assertSame(events, [...EXPECTED_EVENTS], "Inngest event names drifted");

for (const fn of functions) {
  const id = readFunctionId(fn);
  const idempotency = (fn as { opts?: { idempotency?: string } }).opts?.idempotency ?? null;
  const expectIdempotency =
    id === ADS_FUNCTION_IDS.applyRequested || id === LEGACY_ADS_FUNCTION_IDS.applyRequested
      ? "event.data.applyJobId"
      : null;
  if (idempotency !== expectIdempotency) {
    throw new Error(`${id} idempotency is ${String(idempotency)}, expected ${String(expectIdempotency)}`);
  }
}

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
if (clientSrc.includes("process.env.INNGEST_APP_ID")) {
  throw new Error("ads Inngest client must not read INNGEST_APP_ID");
}

console.log(JSON.stringify({ ok: true, appId: "cerevex-ads", functions: FUNCTION_IDS }, null, 2));
