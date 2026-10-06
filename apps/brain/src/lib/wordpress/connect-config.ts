import { wordpressConnectBlockedFromWorkspace, wordpressWorkspaceSettingsFromStore } from './capabilities';
import type { WordpressStoreConfig } from './store';

export type WordpressConnectConfigInput = {
  wordpress: WordpressStoreConfig;
};

/**
 * New WordPress site config. The kill switch defaults ON for this site.
 * The selected store's workspace is not copied. A new site does not inherit
 * another client's business type, modules, or flags.
 */
export function newWordpressStoreConfig(input: WordpressConnectConfigInput): {
  wordpress: WordpressStoreConfig;
} {
  return {
    wordpress: {
      ...input.wordpress,
      applyKillSwitch: input.wordpress.applyKillSwitch ?? true,
    },
  };
}

export function wordpressConnectBlockedFromSource(source: {
  workspaceSettings?: Record<string, unknown> | null;
  store?: { config?: Record<string, unknown> } | null;
} | null | undefined): string | null {
  const workspace = source?.workspaceSettings ?? wordpressWorkspaceSettingsFromStore(source?.store);
  return wordpressConnectBlockedFromWorkspace(workspace);
}
