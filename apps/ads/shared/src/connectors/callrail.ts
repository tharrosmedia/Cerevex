import { mockCallRailCalls, type CallRecord } from "../attribution";
import { readProcessEnv } from "@cerevex/contracts";
import type {
  CallTrackingConnector,
  CallTrackingPullInput,
  CallTrackingPullResult,
  ConnectorConnectInput,
  ConnectorConnectResult,
} from "./types";

const CALLRAIL_API = "https://api.callrail.com/v3";

export function callRailEnvCredentials(env = readProcessEnv()): { apiKey: string; accountId: string } | null {
  const apiKey = (env.CALLRAIL_API_KEY ?? "").trim();
  const accountId = (env.CALLRAIL_ACCOUNT_ID ?? "").trim();
  if (!apiKey || !accountId) return null;
  return { apiKey, accountId };
}

function authHeader(apiKey: string): string {
  return `Token token=${apiKey}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function last4(phone: unknown): string | undefined {
  const digits = asString(phone).replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

function mapCallRailCall(row: Record<string, unknown>): CallRecord {
  return {
    id: asString(row.id || row.resource_id),
    startTime: asString(row.start_time || row.created_at),
    answered: Boolean(row.answered),
    durationSeconds: Number(row.duration ?? 0) || 0,
    source: asString(row.source),
    campaign: asString(row.campaign),
    utmSource: asString(row.utm_source) || undefined,
    utmMedium: asString(row.utm_medium) || undefined,
    utmCampaign: asString(row.utm_campaign) || undefined,
    trackingNumber: asString(row.tracking_phone_number) || undefined,
    customerPhoneLast4: last4(row.customer_phone_number),
    firstCall: row.first_call == null ? undefined : Boolean(row.first_call),
    conversion: Boolean(row.conversion),
    valueUsd: row.value == null || row.value === "" ? null : asString(row.value),
    companyId: asString(row.company_id) || undefined,
  };
}

export class CallRailConnector implements CallTrackingConnector {
  readonly kind = "call_tracking" as const;
  readonly implementation = "live" as const;
  readonly id = "callrail" as const;
  readonly label = "CallRail";
  readonly mode = "connect" as const;
  readonly connectCapability = "m52.callrail_connect" as const;

  isConfigured(): boolean {
    return callRailEnvCredentials() != null;
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (input.mock) {
      return {
        ok: true,
        stub: false,
        mock: true,
        connectorId: this.id,
        externalId: input.accountId || input.externalId || "mock-callrail",
        reason: "Mock CallRail connected. No live CallRail write.",
      };
    }
    const env = callRailEnvCredentials();
    const apiKey = input.apiKey || (input.useEnv ? env?.apiKey : undefined);
    const accountId = input.accountId || input.externalId || (input.useEnv ? env?.accountId : undefined);
    if (!apiKey || !accountId) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        reason: "CallRail needs an API key and account id, or use mock connect.",
      };
    }
    const checked = await this.verifyAccount(apiKey, accountId);
    if (!checked.ok) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        reason: checked.reason,
      };
    }
    return {
      ok: true,
      stub: false,
      mock: false,
      connectorId: this.id,
      externalId: accountId,
      reason: "CallRail connected. Calls can be pulled. Nothing is written to CallRail.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      reason: "CallRail disconnected. Stored key was removed. No CallRail write.",
    };
  }

  async pullCalls(input: CallTrackingPullInput): Promise<CallTrackingPullResult> {
    if (input.mock) {
      return {
        ok: true,
        mock: true,
        connectorId: this.id,
        calls: mockCallRailCalls(input.clientName),
        reason: "Mock CallRail calls. Safe for QA without live credentials.",
      };
    }
    const env = callRailEnvCredentials();
    const apiKey = input.apiKey || env?.apiKey;
    const accountId = input.accountId || env?.accountId;
    if (!apiKey || !accountId) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        calls: [],
        reason: "CallRail is not configured. Connect with an API key or use mock.",
      };
    }
    try {
      const url = new URL(`${CALLRAIL_API}/a/${encodeURIComponent(accountId)}/calls.json`);
      url.searchParams.set("per_page", "50");
      url.searchParams.set("fields", "id,start_time,answered,duration,source,campaign,utm_source,utm_medium,utm_campaign,tracking_phone_number,customer_phone_number,first_call,conversion,value,company_id");
      const res = await fetch(url, {
        headers: { Authorization: authHeader(apiKey) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          mock: false,
          connectorId: this.id,
          calls: [],
          reason: `CallRail calls failed (${res.status}). Nothing was written.`,
        };
      }
      const body = (await res.json()) as { calls?: Record<string, unknown>[] };
      const calls = (body.calls ?? []).map(mapCallRailCall).filter((row) => row.id);
      return {
        ok: true,
        mock: false,
        connectorId: this.id,
        calls,
        reason: `${calls.length} CallRail call${calls.length === 1 ? "" : "s"} pulled. Read only.`,
      };
    } catch (error) {
      return {
        ok: false,
        mock: false,
        connectorId: this.id,
        calls: [],
        reason: error instanceof Error ? error.message : "CallRail pull failed.",
      };
    }
  }

  private async verifyAccount(apiKey: string, accountId: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const res = await fetch(`${CALLRAIL_API}/a/${encodeURIComponent(accountId)}.json`, {
        headers: { Authorization: authHeader(apiKey) },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { ok: true };
      return { ok: false, reason: `CallRail account check failed (${res.status}).` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "CallRail account check failed." };
    }
  }
}

export const callRailConnector = new CallRailConnector();
