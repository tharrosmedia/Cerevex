import { Inngest } from "inngest";
import { loadEnv } from "./env";
import {
  EVENTS,
  type AdAccountSyncPayload,
  type ApplyRequestedPayload,
  type StubPingPayload,
  type StubSyncPayload,
} from "./types";

loadEnv();

/** Distinct app id locally so Brain seo-* sync is not overwritten. Share Inngest Cloud keys — do not provision a second org. */
export const inngest = new Inngest({
  id: process.env.OS_INNGEST_APP_ID || process.env.INNGEST_APP_ID || "tharros-os",
});

export { EVENTS };

export function inngestDevUrl(): string | null {
  const value = process.env.INNGEST_DEV;
  if (!value || value === "0" || value === "false") return null;
  if (value === "1" || value === "true") return "http://127.0.0.1:8288";
  return value;
}

export async function checkInngest(): Promise<"ok" | "degraded" | "down"> {
  const devUrl = inngestDevUrl();
  if (devUrl) {
    try {
      const res = await fetch(devUrl, { signal: AbortSignal.timeout(1500) });
      return res.ok ? "ok" : "degraded";
    } catch {
      return "down";
    }
  }
  if (process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY) {
    return "ok";
  }
  return "degraded";
}

export async function sendStubPing(data: StubPingPayload): Promise<string[]> {
  const result = await inngest.send({ name: EVENTS.stubPing, data });
  return result.ids;
}

export async function sendStubSync(data: StubSyncPayload): Promise<string[]> {
  const result = await inngest.send({ name: EVENTS.stubSync, data });
  return result.ids;
}

export async function sendApplyRequested(data: ApplyRequestedPayload): Promise<string[]> {
  const result = await inngest.send({ name: EVENTS.applyRequested, data });
  return result.ids;
}

export function adAccountSyncEvent(platform: AdAccountSyncPayload["platform"]): string {
  return platform === "meta" ? EVENTS.metaAdsAccountSync : EVENTS.googleAdsAccountSync;
}

export async function sendAdAccountSync(data: AdAccountSyncPayload): Promise<string[]> {
  const result = await inngest.send({ name: adAccountSyncEvent(data.platform), data });
  return result.ids;
}
