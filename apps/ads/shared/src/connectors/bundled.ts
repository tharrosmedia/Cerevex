/**
 * Lean Twilio-class bundled call tracking (M5.2 Phase B).
 * Same CallTrackingConnector surface as CallRail. No number purchase, no routing writes.
 */

import { mockBundledCalls, type CallRecord } from "../attribution";
import { readProcessEnv } from "@cerevex/contracts";
import type {
  CallTrackingConnector,
  CallTrackingPullInput,
  CallTrackingPullResult,
  ConnectorConnectInput,
  ConnectorConnectResult,
} from "./types";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function twilioEnvCredentials(
  env = readProcessEnv(),
): { accountSid: string; authToken: string; trackingNumber?: string } | null {
  const accountSid = (env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!accountSid || !authToken) return null;
  const trackingNumber = (env.TWILIO_TRACKING_NUMBER ?? "").trim() || undefined;
  return { accountSid, authToken, trackingNumber };
}

function basicAuth(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function last4(phone: unknown): string | undefined {
  const digits = asString(phone).replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

function digitsOnly(phone: unknown): string {
  return asString(phone).replace(/\D/g, "");
}

function answeredFromStatus(status: string, durationSeconds: number): boolean {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "in-progress") return true;
  if (normalized === "no-answer" || normalized === "busy" || normalized === "failed" || normalized === "canceled") {
    return false;
  }
  return durationSeconds > 0;
}

export function refusesUnsupervisedTelephonyWrite(input: ConnectorConnectInput): string | null {
  if (input.purchaseNumber) {
    return "Bundled will not buy a phone number from here. Attach an existing number or use mock.";
  }
  if (input.voiceUrl) {
    return "Bundled will not change call routing from here. Attach an existing number or use mock.";
  }
  return null;
}

function mapTwilioCall(
  row: Record<string, unknown>,
  campaignLabel?: string,
): CallRecord {
  const durationSeconds = Number(row.duration ?? 0) || 0;
  const status = asString(row.status);
  const answered = answeredFromStatus(status, durationSeconds);
  return {
    id: asString(row.sid || row.id),
    startTime: asString(row.start_time || row.date_created),
    answered,
    durationSeconds,
    source: "Bundled",
    campaign: campaignLabel ?? "",
    trackingNumber: asString(row.to) || undefined,
    customerPhoneLast4: last4(row.from),
    firstCall: undefined,
    conversion: answered && durationSeconds >= 60,
    valueUsd: null,
  };
}

export class BundledCallTrackingConnector implements CallTrackingConnector {
  readonly kind = "call_tracking" as const;
  readonly implementation = "live" as const;
  readonly id = "bundled" as const;
  readonly label = "Bundled call tracking";
  readonly mode = "bundled" as const;
  readonly connectCapability = "m52.bundled_call_tracking" as const;

  isConfigured(): boolean {
    return twilioEnvCredentials() != null;
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    const blocked = refusesUnsupervisedTelephonyWrite(input);
    if (blocked) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        purchased: false,
        routingChanged: false,
        reason: blocked,
      };
    }
    if (input.mock) {
      return {
        ok: true,
        stub: false,
        mock: true,
        connectorId: this.id,
        externalId: input.accountSid || input.externalId || "mock-twilio",
        trackingNumber: input.trackingNumber || "+1-555-0140",
        purchased: false,
        routingChanged: false,
        reason: "Mock bundled call tracking connected. No number was bought. No routing changed.",
      };
    }
    const env = twilioEnvCredentials();
    const accountSid = input.accountSid || input.externalId || (input.useEnv ? env?.accountSid : undefined);
    const authToken = input.authToken || (input.useEnv ? env?.authToken : undefined);
    if (!accountSid || !authToken) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        purchased: false,
        routingChanged: false,
        reason: "Bundled needs a Twilio Account SID and Auth Token, or use mock connect.",
      };
    }
    const checked = await this.verifyAccount(accountSid, authToken);
    if (!checked.ok) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        purchased: false,
        routingChanged: false,
        reason: checked.reason,
      };
    }
    const trackingNumber = input.trackingNumber || (input.useEnv ? env?.trackingNumber : undefined);
    if (trackingNumber) {
      const existing = await this.verifyExistingNumber(accountSid, authToken, trackingNumber);
      if (!existing.ok) {
        return {
          ok: false,
          stub: false,
          mock: false,
          connectorId: this.id,
          purchased: false,
          routingChanged: false,
          reason: existing.reason,
        };
      }
    }
    return {
      ok: true,
      stub: false,
      mock: false,
      connectorId: this.id,
      externalId: accountSid,
      trackingNumber,
      purchased: false,
      routingChanged: false,
      reason: trackingNumber
        ? "Bundled connected. Existing tracking number attached. No number was bought and routing was not changed."
        : "Bundled connected. Calls can be pulled. No number was bought and routing was not changed.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      purchased: false,
      routingChanged: false,
      reason: "Bundled call tracking disconnected. Stored credentials were removed. No Twilio write.",
    };
  }

  async pullCalls(input: CallTrackingPullInput): Promise<CallTrackingPullResult> {
    if (input.mock) {
      return {
        ok: true,
        mock: true,
        connectorId: this.id,
        calls: mockBundledCalls(input.clientName, undefined, input.campaignLabel),
        reason: "Mock bundled calls. Safe for QA without live Twilio credentials.",
      };
    }
    const env = twilioEnvCredentials();
    const accountSid = input.accountSid || env?.accountSid;
    const authToken = input.authToken || env?.authToken;
    if (!accountSid || !authToken) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        calls: [],
        reason: "Bundled is not configured. Connect with Twilio credentials or use mock.",
      };
    }
    try {
      const url = new URL(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Calls.json`);
      url.searchParams.set("PageSize", "50");
      const trackingNumber = input.trackingNumber || env?.trackingNumber;
      if (trackingNumber) url.searchParams.set("To", trackingNumber);
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(accountSid, authToken) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          mock: false,
          connectorId: this.id,
          calls: [],
          reason: `Twilio call log failed (${res.status}). Nothing was written.`,
        };
      }
      const body = (await res.json()) as { calls?: Record<string, unknown>[] };
      let calls = (body.calls ?? []).map((row) => mapTwilioCall(row, input.campaignLabel)).filter((row) => row.id);
      if (trackingNumber) {
        const want = digitsOnly(trackingNumber);
        calls = calls.filter((row) => !want || digitsOnly(row.trackingNumber) === want);
      }
      return {
        ok: true,
        mock: false,
        connectorId: this.id,
        calls,
        reason: `${calls.length} bundled call${calls.length === 1 ? "" : "s"} pulled. Read only.`,
      };
    } catch (error) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        calls: [],
        reason: error instanceof Error ? error.message : "Bundled pull failed.",
      };
    }
  }

  private async verifyAccount(accountSid: string, authToken: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}.json`, {
        headers: { Authorization: basicAuth(accountSid, authToken) },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true };
      return { ok: false, reason: `Twilio account check failed (${res.status}).` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Twilio account check failed." };
    }
  }

  private async verifyExistingNumber(
    accountSid: string,
    authToken: string,
    trackingNumber: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      const url = new URL(
        `${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json`,
      );
      url.searchParams.set("PhoneNumber", trackingNumber);
      const res = await fetch(url, {
        headers: { Authorization: basicAuth(accountSid, authToken) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return { ok: false, reason: `Twilio number check failed (${res.status}). Nothing was purchased.` };
      }
      const body = (await res.json()) as { incoming_phone_numbers?: unknown[] };
      if ((body.incoming_phone_numbers ?? []).length === 0) {
        return {
          ok: false,
          reason: "That tracking number is not on this Twilio account. Bundled will not buy one.",
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Twilio number check failed." };
    }
  }
}

export const bundledCallTrackingConnector = new BundledCallTrackingConnector();
