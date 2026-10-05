import { adsApi } from "../../lib/ads-bff";

const GATE_CACHE_MS = 15_000;

const cache = new Map<string, { at: number; capabilities: Record<string, string> }>();

export function clearAdsApplyGateCache(): void {
  cache.clear();
}

/**
 * Ads is the gate. A short memory cache avoids a round trip on every render.
 * Error, timeout, a non-JSON body, or a workspace id that is not Brain's all fail closed.
 */
export async function readAuthoritativeApplyFlags(): Promise<Record<string, string> | null> {
  const workspaceId = process.env.ADS_INTERNAL_WORKSPACE_ID?.trim();
  if (!workspaceId) return null;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < GATE_CACHE_MS) return hit.capabilities;
  try {
    const result = await adsApi<{
      workspace?: { id?: string; capabilities?: Record<string, string> } | null;
    }>(`/workspace?workspaceId=${encodeURIComponent(workspaceId)}`);
    const workspace = result.ok ? result.data.workspace : null;
    if (!result.ok || !workspace || workspace.id !== workspaceId || !workspace.capabilities) {
      cache.delete(workspaceId);
      return null;
    }
    cache.set(workspaceId, { at: Date.now(), capabilities: workspace.capabilities });
    return workspace.capabilities;
  } catch {
    cache.delete(workspaceId);
    return null;
  }
}

export async function authoritativeApplyOn(id: "site.wordpress.apply" | "seo.gsc.apply"): Promise<boolean> {
  const flags = await readAuthoritativeApplyFlags();
  return flags?.[id] === "on";
}
