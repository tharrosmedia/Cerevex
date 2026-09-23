/**
 * Per-client connector state in workspaces.settings_json.
 * No ALTER — schema os stays. Secrets stay encrypted.
 */

import type { CapabilityFlags } from "@cerevex/contracts";
import { isCapabilityVisible } from "@cerevex/contracts";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb } from "./db";
import { workspaces } from "./schema";
import type { BookedJob, CallRecord } from "./attribution";
import { publicClarityView, type SessionSignalsSnapshot } from "./lp-intelligence";

export type CallRailClientState = {
  connected: boolean;
  mock: boolean;
  accountId: string | null;
  companyId?: string | null;
  encryptedApiKey?: string | null;
  usesEnv?: boolean;
  lastPulledAt?: string | null;
  lastError?: string | null;
  snapshot?: {
    pulledAt: string;
    mock: boolean;
    calls: CallRecord[];
  };
};

export type CrmClientState = {
  connected: boolean;
  mock: boolean;
  provider: "hcp";
  lastError?: string | null;
  bookedJobs: BookedJob[];
};

export type BundledClientState = {
  connected: boolean;
  mock: boolean;
  accountSid: string | null;
  trackingNumber?: string | null;
  campaignLabel?: string | null;
  encryptedAuthToken?: string | null;
  usesEnv?: boolean;
  lastPulledAt?: string | null;
  lastError?: string | null;
  snapshot?: {
    pulledAt: string;
    mock: boolean;
    calls: CallRecord[];
  };
};

export type ClarityClientState = {
  connected: boolean;
  mock: boolean;
  projectId: string | null;
  encryptedApiKey?: string | null;
  usesEnv?: boolean;
  lastPulledAt?: string | null;
  lastError?: string | null;
  snapshot?: SessionSignalsSnapshot;
};

export type ConnectorSettings = {
  callrail: Record<string, CallRailClientState>;
  bundled: Record<string, BundledClientState>;
  crm: Record<string, CrmClientState>;
  clarity: Record<string, ClarityClientState>;
};

export type CallTrackingSource = "callrail" | "bundled";

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export function readConnectorSettings(settingsJson: unknown): ConnectorSettings {
  const root = asRecord(settingsJson);
  const connectors = asRecord(root.connectors);
  const callrailRaw = asRecord(connectors.callrail);
  const bundledRaw = asRecord(connectors.bundled);
  const crmRaw = asRecord(connectors.crm);
  const clarityRaw = asRecord(connectors.clarity);
  const callrail: Record<string, CallRailClientState> = {};
  const bundled: Record<string, BundledClientState> = {};
  const crm: Record<string, CrmClientState> = {};
  const clarity: Record<string, ClarityClientState> = {};
  for (const [clientId, value] of Object.entries(callrailRaw)) {
    const row = asRecord(value);
    const snapshot = asRecord(row.snapshot);
    callrail[clientId] = {
      connected: Boolean(row.connected),
      mock: Boolean(row.mock),
      accountId: typeof row.accountId === "string" ? row.accountId : null,
      companyId: typeof row.companyId === "string" ? row.companyId : null,
      encryptedApiKey: typeof row.encryptedApiKey === "string" ? row.encryptedApiKey : null,
      usesEnv: Boolean(row.usesEnv),
      lastPulledAt: typeof row.lastPulledAt === "string" ? row.lastPulledAt : null,
      lastError: typeof row.lastError === "string" ? row.lastError : null,
      snapshot:
        typeof snapshot.pulledAt === "string" && Array.isArray(snapshot.calls)
          ? {
              pulledAt: snapshot.pulledAt,
              mock: Boolean(snapshot.mock),
              calls: snapshot.calls as CallRecord[],
            }
          : undefined,
    };
  }
  for (const [clientId, value] of Object.entries(bundledRaw)) {
    const row = asRecord(value);
    const snapshot = asRecord(row.snapshot);
    bundled[clientId] = {
      connected: Boolean(row.connected),
      mock: Boolean(row.mock),
      accountSid: typeof row.accountSid === "string" ? row.accountSid : null,
      trackingNumber: typeof row.trackingNumber === "string" ? row.trackingNumber : null,
      campaignLabel: typeof row.campaignLabel === "string" ? row.campaignLabel : null,
      encryptedAuthToken: typeof row.encryptedAuthToken === "string" ? row.encryptedAuthToken : null,
      usesEnv: Boolean(row.usesEnv),
      lastPulledAt: typeof row.lastPulledAt === "string" ? row.lastPulledAt : null,
      lastError: typeof row.lastError === "string" ? row.lastError : null,
      snapshot:
        typeof snapshot.pulledAt === "string" && Array.isArray(snapshot.calls)
          ? {
              pulledAt: snapshot.pulledAt,
              mock: Boolean(snapshot.mock),
              calls: snapshot.calls as CallRecord[],
            }
          : undefined,
    };
  }
  for (const [clientId, value] of Object.entries(crmRaw)) {
    const row = asRecord(value);
    crm[clientId] = {
      connected: Boolean(row.connected),
      mock: Boolean(row.mock),
      provider: "hcp",
      lastError: typeof row.lastError === "string" ? row.lastError : null,
      bookedJobs: Array.isArray(row.bookedJobs) ? (row.bookedJobs as BookedJob[]) : [],
    };
  }
  for (const [clientId, value] of Object.entries(clarityRaw)) {
    const row = asRecord(value);
    const snapshot = asRecord(row.snapshot);
    clarity[clientId] = {
      connected: Boolean(row.connected),
      mock: Boolean(row.mock),
      projectId: typeof row.projectId === "string" ? row.projectId : null,
      encryptedApiKey: typeof row.encryptedApiKey === "string" ? row.encryptedApiKey : null,
      usesEnv: Boolean(row.usesEnv),
      lastPulledAt: typeof row.lastPulledAt === "string" ? row.lastPulledAt : null,
      lastError: typeof row.lastError === "string" ? row.lastError : null,
      snapshot:
        typeof snapshot.pulledAt === "string" && Array.isArray(snapshot.signals)
          ? {
              pulledAt: snapshot.pulledAt,
              mock: Boolean(snapshot.mock),
              projectId: typeof snapshot.projectId === "string" ? snapshot.projectId : null,
              sessionCount: Number(snapshot.sessionCount ?? 0) || 0,
              signals: snapshot.signals as SessionSignalsSnapshot["signals"],
              capture: false,
              writes: false,
            }
          : undefined,
    };
  }
  return { callrail, bundled, crm, clarity };
}

export function settingsJsonWithConnectors(
  existing: Record<string, unknown>,
  next: ConnectorSettings,
): Record<string, unknown> {
  return {
    ...existing,
    connectors: {
      callrail: next.callrail,
      bundled: next.bundled,
      crm: next.crm,
      clarity: next.clarity,
    },
  };
}

export function publicCallRailView(state: CallRailClientState | undefined): {
  connected: boolean;
  mock: boolean;
  accountId: string | null;
  usesEnv: boolean;
  hasApiKey: boolean;
  lastPulledAt: string | null;
  lastError: string | null;
  callCount: number;
} {
  return {
    connected: Boolean(state?.connected),
    mock: Boolean(state?.mock),
    accountId: state?.accountId ?? null,
    usesEnv: Boolean(state?.usesEnv),
    hasApiKey: Boolean(state?.encryptedApiKey),
    lastPulledAt: state?.lastPulledAt ?? null,
    lastError: state?.lastError ?? null,
    callCount: state?.snapshot?.calls.length ?? 0,
  };
}

export function publicBundledView(state: BundledClientState | undefined): {
  connected: boolean;
  mock: boolean;
  accountSid: string | null;
  trackingNumber: string | null;
  campaignLabel: string | null;
  usesEnv: boolean;
  hasAuthToken: boolean;
  lastPulledAt: string | null;
  lastError: string | null;
  callCount: number;
  purchased: false;
  routingChanged: false;
} {
  return {
    connected: Boolean(state?.connected),
    mock: Boolean(state?.mock),
    accountSid: state?.accountSid ?? null,
    trackingNumber: state?.trackingNumber ?? null,
    campaignLabel: state?.campaignLabel ?? null,
    usesEnv: Boolean(state?.usesEnv),
    hasAuthToken: Boolean(state?.encryptedAuthToken),
    lastPulledAt: state?.lastPulledAt ?? null,
    lastError: state?.lastError ?? null,
    callCount: state?.snapshot?.calls.length ?? 0,
    purchased: false,
    routingChanged: false,
  };
}

export function publicCrmView(state: CrmClientState | undefined): {
  connected: boolean;
  mock: boolean;
  provider: "hcp";
  bookedJobCount: number;
  lastError: string | null;
} {
  return {
    connected: Boolean(state?.connected),
    mock: Boolean(state?.mock),
    provider: "hcp",
    bookedJobCount: state?.bookedJobs.length ?? 0,
    lastError: state?.lastError ?? null,
  };
}

export function encryptCallRailApiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptCallRailApiKey(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

export { publicClarityView };

export function encryptClarityApiKey(apiKey: string): string {
  return encryptSecret(apiKey);
}

export function decryptClarityApiKey(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

export function encryptTwilioAuthToken(authToken: string): string {
  return encryptSecret(authToken);
}

export function decryptTwilioAuthToken(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

/**
 * CallRail wins when both are connected so Connect customers stay on Phase A.
 * Bundled is only selected when CallRail is disconnected (or its flag is hidden).
 */
export function resolveCallTrackingForClient(
  connectors: ConnectorSettings,
  clientId: string,
  flags: CapabilityFlags,
): {
  source: CallTrackingSource | null;
  calls: CallRecord[];
  callrail: CallRailClientState | undefined;
  bundled: BundledClientState | undefined;
  sourceLabel: string;
} {
  const callrail = connectors.callrail[clientId];
  const bundled = connectors.bundled[clientId];
  const callrailLive = isCapabilityVisible("m52.callrail_connect", flags) && Boolean(callrail?.connected);
  const bundledLive = isCapabilityVisible("m52.bundled_call_tracking", flags) && Boolean(bundled?.connected);
  if (callrailLive) {
    return {
      source: "callrail",
      calls: callrail?.snapshot?.calls ?? [],
      callrail,
      bundled,
      sourceLabel: "CallRail",
    };
  }
  if (bundledLive) {
    return {
      source: "bundled",
      calls: bundled?.snapshot?.calls ?? [],
      callrail,
      bundled,
      sourceLabel: "bundled call tracking",
    };
  }
  return { source: null, calls: [], callrail, bundled, sourceLabel: "CallRail" };
}

export async function loadWorkspaceSettings(workspaceId: string): Promise<{
  settings: Record<string, unknown>;
  connectors: ConnectorSettings;
}> {
  const workspace = await getDb().query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  const settings = asRecord(workspace?.settingsJson);
  return { settings, connectors: readConnectorSettings(settings) };
}

export async function saveWorkspaceConnectors(
  workspaceId: string,
  connectors: ConnectorSettings,
): Promise<ConnectorSettings> {
  const { settings } = await loadWorkspaceSettings(workspaceId);
  const next = settingsJsonWithConnectors(settings, connectors);
  await getDb().update(workspaces).set({ settingsJson: next }).where(eq(workspaces.id, workspaceId));
  return connectors;
}
