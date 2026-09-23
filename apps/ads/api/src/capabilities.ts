import { HTTPException } from "hono/http-exception";
import {
  CAPABILITY_CATALOG_LIST,
  capabilityOffMessage,
  envCapabilityKills,
  isCapabilityOn,
  isCapabilityWritable,
  readWorkspaceCapabilities,
  type CapabilityFlags,
  type CapabilityId,
} from "@tharros/ads-shared";
import { getDb } from "@tharros/ads-shared/db";
import { workspaces } from "@tharros/ads-shared/schema";
import { eq } from "drizzle-orm";

export async function loadWorkspaceCapabilities(workspaceId: string): Promise<{
  flags: CapabilityFlags;
  settingsJson: unknown;
}> {
  const workspace = await getDb().query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  return {
    flags: readWorkspaceCapabilities(workspace?.settingsJson),
    settingsJson: workspace?.settingsJson ?? {},
  };
}

/**
 * Writes only. Read paths must not call this — cockpit/ads GET never throws when a flag is off.
 */
export async function requireWritableCapability(workspaceId: string, id: CapabilityId): Promise<CapabilityFlags> {
  const { flags } = await loadWorkspaceCapabilities(workspaceId);
  if (!isCapabilityWritable(id, flags)) {
    throw new HTTPException(409, { message: capabilityOffMessage(id, flags) });
  }
  return flags;
}

export function capabilityPublicMeta(flags: CapabilityFlags) {
  return {
    capabilities: flags,
    capabilityCatalog: CAPABILITY_CATALOG_LIST,
    capabilityKills: envCapabilityKills(),
    capabilityOn: Object.fromEntries(CAPABILITY_CATALOG_LIST.map((entry) => [entry.id, isCapabilityOn(entry.id, flags)])),
  };
}
