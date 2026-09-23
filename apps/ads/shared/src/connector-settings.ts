/**
 * Per-client connector state in workspaces.settings_json.
 * No ALTER — schema os stays. Secrets stay encrypted.
 */

import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb } from "./db";
import { workspaces } from "./schema";
import type { BookedJob, CallRecord } from "./attribution";

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

export type ConnectorSettings = {
  callrail: Record<string, CallRailClientState>;
  crm: Record<string, CrmClientState>;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export function readConnectorSettings(settingsJson: unknown): ConnectorSettings {
  const root = asRecord(settingsJson);
  const connectors = asRecord(root.connectors);
  const callrailRaw = asRecord(connectors.callrail);
  const crmRaw = asRecord(connectors.crm);
  const callrail: Record<string, CallRailClientState> = {};
  const crm: Record<string, CrmClientState> = {};
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
  return { callrail, crm };
}

export function settingsJsonWithConnectors(
  existing: Record<string, unknown>,
  next: ConnectorSettings,
): Record<string, unknown> {
  return {
    ...existing,
    connectors: {
      callrail: next.callrail,
      crm: next.crm,
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
