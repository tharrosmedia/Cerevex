import Link from 'next/link';
import { adsApi, type AdsClient } from '@/lib/ads-bff';
import { listStores } from '@/src/lib/db/stores';
import { SubmitButton } from '@/components/submit-button';

async function linkClientAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const clientId = String(formData.get('clientId') || '');
  const siteId = String(formData.get('siteId') || '');
  if (!clientId || !siteId) redirect('/settings?adslink=missing#ads-accounts');
  const result = await adsApi(`/clients/${encodeURIComponent(clientId)}/site`, {
    method: 'POST',
    body: JSON.stringify({ siteId }),
  });
  revalidatePath('/settings');
  revalidatePath('/ads');
  if (!result.ok) redirect(`/settings?adslink=error&message=${encodeURIComponent(result.message)}#ads-accounts`);
  redirect('/settings?adslink=linked#ads-accounts');
}

/**
 * Ads accounts are owned by a store/site. Existing ads clients whose names match a store link
 * automatically; this lists the rest so an admin can link them once.
 */
export async function AdsSiteLinks({ message, status }: { message?: string; status?: string }) {
  const [clientsRes, stores] = await Promise.all([
    adsApi<{ clients: AdsClient[] }>('/clients'),
    listStores().catch(() => [] as any[]),
  ]);

  const clients = clientsRes.ok ? clientsRes.data.clients : [];
  const linkedSiteIds = new Set(clients.map((c) => c.siteId).filter(Boolean));
  const unlinked = clients.filter((c) => !c.siteId);
  const freeStores = (stores as any[]).filter((s) => !linkedSiteIds.has(s.id));
  const siteName = (id?: string | null) => (stores as any[]).find((s) => s.id === id)?.name;

  return (
    <div id="ads-accounts" className="cx-panel">
      <h2>Ads accounts</h2>
      <p className="cx-help">
        Each store or site has its own Meta and Google Ads accounts. Connect them from{' '}
        <Link href="/ads">Ads</Link> while that store is selected.
      </p>

      {status === 'linked' ? <p className="cx-banner" role="status">Linked. That store now uses those ad accounts.</p> : null}
      {status === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{message || 'Could not link.'}</p> : null}
      {status === 'missing' ? <p className="cx-banner cx-banner-warn" role="status">Choose a store to link.</p> : null}
      {!clientsRes.ok ? <p className="cx-help">Could not load ad account owners: {clientsRes.message}</p> : null}

      {unlinked.length > 0 ? (
        <>
          <h3 className="cx-card-title">Link existing ad accounts to a store</h3>
          <p className="cx-help">These were set up before stores owned their ad accounts. Link each one once.</p>
          <ul className="cx-site-list">
            {unlinked.map((client) => (
              <li key={client.id} className="cx-card">
                <form action={linkClientAction} className="cx-filters" style={{ marginBottom: 0 }}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <label>
                    {client.name}
                    {client.connectedPlatforms?.length ? ` (${client.connectedPlatforms.map((p) => (p === 'google' ? 'Google Ads' : 'Meta')).join(', ')})` : ''}
                    <select name="siteId" defaultValue="">
                      <option value="" disabled>Choose a store</option>
                      {freeStores.map((store: any) => (
                        <option key={store.id} value={store.id}>{store.name}</option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton className="btn-secondary" pendingLabel="Linking…" disabled={freeStores.length === 0}>Link</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {clients.some((c) => c.siteId) ? (
        <ul className="cx-status-list">
          {clients.filter((c) => c.siteId).map((client) => (
            <li key={client.id}>
              <span>{siteName(client.siteId) || client.name}</span>
              <span>
                {client.connectedPlatforms?.length
                  ? client.connectedPlatforms.map((p) => (p === 'google' ? 'Google Ads' : 'Meta')).join(', ')
                  : 'No ad accounts yet'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
