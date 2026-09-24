import { wordpressConnectBlockedFromWorkspace, wordpressWorkspaceSettingsFromStore } from './capabilities';
import type { WordpressStoreConfig } from './store';

export type WordpressConnectConfigInput = {
  wordpress: WordpressStoreConfig;
  workspaceSettings?: Record<string, unknown> | null;
};

/**
 * New WP store config: kill switch defaults ON; inherit workspace flags
 * from the Settings source store so Connect → sync/apply keep working.
 */
export function newWordpressStoreConfig(input: WordpressConnectConfigInput): {
  wordpress: WordpressStoreConfig;
  workspace?: Record<string, unknown>;
} {
  const workspace = input.workspaceSettings && typeof input.workspaceSettings === 'object' && !Array.isArray(input.workspaceSettings)
    ? { ...input.workspaceSettings }
    : undefined;
  return {
    wordpress: {
      ...input.wordpress,
      applyKillSwitch: input.wordpress.applyKillSwitch ?? true,
    },
    ...(workspace ? { workspace } : {}),
  };
}

export function wordpressConnectBlockedFromSource(source: {
  workspaceSettings?: Record<string, unknown> | null;
  store?: { config?: Record<string, unknown> } | null;
} | null | undefined): string | null {
  const workspace = source?.workspaceSettings ?? wordpressWorkspaceSettingsFromStore(source?.store);
  return wordpressConnectBlockedFromWorkspace(workspace);
}
