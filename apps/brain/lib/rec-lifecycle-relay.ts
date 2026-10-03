import { adsApi } from '@/lib/ads-bff';

export type ApproveRelayBody = {
  clientId?: unknown;
  recommendationId?: unknown;
  storeId?: unknown;
  status?: unknown;
  version?: unknown;
  module?: unknown;
};

/**
 * Map an approve-route body onto the shared lifecycle helper.
 * Returns null when the body does not name a client, so SEO approvals
 * that have no ads client stay on the existing Inngest path.
 */
export function lifecycleBodyFromApprove(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as ApproveRelayBody;
  if (typeof row.clientId !== 'string' || row.clientId.length === 0) return null;
  const status = typeof row.status === 'string' ? row.status : '';
  const storeId = typeof row.storeId === 'string' ? row.storeId : null;
  if (status === 'prompt_layer_approved' || status === 'prompt_layer_rolled_back') {
    if (typeof row.version !== 'string' || row.version.length === 0) return null;
    return {
      kind: status,
      clientId: row.clientId,
      storeId,
      version: row.version,
      module: 'prompt-layer',
    };
  }
  if (typeof row.recommendationId !== 'string' || row.recommendationId.length === 0) return null;
  if (status === 'approved' || status === 'approve') {
    return { kind: 'approved', clientId: row.clientId, recommendationId: row.recommendationId, storeId, module: 'ads' };
  }
  if (status === 'rejected' || status === 'deny') {
    return { kind: 'rejected', clientId: row.clientId, recommendationId: row.recommendationId, storeId, module: 'ads' };
  }
  if (status === 'mark_done') {
    return { kind: 'mark_done', clientId: row.clientId, recommendationId: row.recommendationId, storeId, module: 'ads' };
  }
  if (status === 'rollback' || status === 'rolled_back') {
    return { kind: 'rolled_back', clientId: row.clientId, recommendationId: row.recommendationId, storeId, module: 'ads' };
  }
  return null;
}

/** Best-effort relay. Does not change approve auth and does not fail the approve response. */
export async function relayApproveToAuditLog(body: unknown): Promise<void> {
  const lifecycle = lifecycleBodyFromApprove(body);
  if (!lifecycle) return;
  await adsApi('/recommendations/lifecycle', {
    method: 'POST',
    body: JSON.stringify(lifecycle),
  });
}
