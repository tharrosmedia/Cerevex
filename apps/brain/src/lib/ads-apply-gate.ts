import { adsApi } from "../../lib/ads-bff";

const GATE_CACHE_MS = 15_000;

const cache = new Map<string, { at: number; capabilities: Record<string, string> }>();

export function clearAdsApplyGateCache(): void {
  cache.clear();
}

/**
 * Ads is the gate. This cache is per process and lasts 15 seconds, so an ads hide
 * can take that long to reach this Brain process and the SEO worker.
 * The SEO worker fails closed unless ADS_API_URL, ADS_INTERNAL_KEY, and
 * ADS_INTERNAL_WORKSPACE_ID are set in that process.
 * Error, timeout, a non-JSON body, or a workspace id that is not Brain's all fail closed.
 */

/** A write needs the stored flag on and ads on. recommend_only stays recommend_only. */
export function effectiveApplyFlag(
  local: string | undefined,
  adsOn: boolean,
): 'on' | 'hidden' | 'recommend_only' {
  if (local === 'recommend_only') return 'recommend_only';
  if (local === 'on' && adsOn) return 'on';
  return 'hidden';
}
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
