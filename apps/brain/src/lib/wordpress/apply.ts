import {
  siteCmsPlainError,
  wordpressApplyBlockedReason,
  type SiteCmsApplyPayload,
  type SiteCmsApplyResult,
} from '@cerevex/contracts';
import { createWordPressConnector } from '@cerevex/connector-wordpress';
import { logEvent } from '../brain/events';
import { getStore } from '../db/stores';
import { wordpressFlagsFromStore } from './capabilities';
import {
  decryptWordpressPluginKey,
  isWordpressStore,
  wordpressApplyBlockedByKillSwitch,
  wordpressSiteUrl,
} from './store';

export async function applyWordpressMutation(input: {
  storeId: string;
  payload: SiteCmsApplyPayload;
  actor?: string;
  jobId?: string;
}): Promise<SiteCmsApplyResult> {
  try {
    const store = await getStore(input.storeId);
    if (!store || !isWordpressStore(store)) {
      const result = { ok: false, writes: false, code: 'not_configured' as const, reason: siteCmsPlainError('not_configured') };
      await logEvent(input.storeId, input.actor || 'system', 'wordpress.apply.blocked', { ...result }, input.jobId);
      return result;
    }
    const blocked = wordpressApplyBlockedReason(wordpressFlagsFromStore(store));
    if (blocked) {
      const result = { ok: false, writes: false, code: 'capability_off' as const, reason: siteCmsPlainError('capability_off') };
      await logEvent(input.storeId, input.actor || 'system', 'wordpress.apply.blocked', { ...result, gate: blocked }, input.jobId);
      return result;
    }
    if (wordpressApplyBlockedByKillSwitch(store)) {
      const result = { ok: false, writes: false, code: 'kill_switch' as const, reason: siteCmsPlainError('kill_switch') };
      await logEvent(input.storeId, input.actor || 'system', 'wordpress.apply.blocked', { ...result }, input.jobId);
      return result;
    }
    const connector = createWordPressConnector({
      siteUrl: wordpressSiteUrl(store),
      pluginKey: decryptWordpressPluginKey(store),
    });
    const result = await connector.apply(input.payload);
    await logEvent(
      input.storeId,
      input.actor || 'system',
      result.ok ? 'wordpress.apply.succeeded' : 'wordpress.apply.failed',
      {
        ok: result.ok,
        writes: result.writes,
        code: result.code,
        reason: result.reason,
        approvalId: input.payload.approvalId,
        externalId: input.payload.externalId,
        resourceType: input.payload.resourceType,
        before: result.before,
        after: result.after,
      },
      input.jobId,
    );
    return result;
  } catch (error) {
    console.warn('[wordpress.apply] degraded', error);
    const result = { ok: false, writes: false, code: 'plugin_down' as const, reason: siteCmsPlainError('plugin_down') };
    try {
      await logEvent(input.storeId, input.actor || 'system', 'wordpress.apply.failed', { ...result }, input.jobId);
    } catch {}
    return result;
  }
}
