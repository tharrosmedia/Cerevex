import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adsApi } from '@/lib/ads-bff';
import { PageHeader } from '@/components/page-header';
import { SubmitButton } from '@/components/submit-button';

export const dynamic = 'force-dynamic';

type PendingAccount = {
  externalId: string;
  name: string;
  currency: string | null;
  detail: string | null;
  alreadyConnected: boolean;
};

type Pending = {
  id: string;
  platform: 'meta' | 'google';
  client: { id: string; name: string; siteId: string | null };
  accounts: PendingAccount[];
};

function platformName(platform: 'meta' | 'google') {
  return platform === 'google' ? 'Google Ads' : 'Meta';
}

async function chooseAccounts(formData: FormData) {
  'use server';
  const pendingId = String(formData.get('pending') || '');
  const externalIds = formData.getAll('account').map(String).filter(Boolean);
  if (externalIds.length === 0) {
    redirect(`/ads/connect/choose?pending=${encodeURIComponent(pendingId)}&error=none`);
  }
  const result = await adsApi<{ connected: number; platform: 'meta' | 'google' }>(
    `/oauth/pending/${encodeURIComponent(pendingId)}/select`,
    { method: 'POST', body: JSON.stringify({ externalIds }) },
  );
  if (!result.ok) {
    redirect(`/ads/connect/choose?pending=${encodeURIComponent(pendingId)}&error=${encodeURIComponent(result.message)}`);
  }
  redirect(`/ads?connected=${result.data.platform}&count=${result.data.connected}`);
}

export default async function ChooseAdAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ pending?: string; error?: string }>;
}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as { pending?: string; error?: string };
  const pendingId = params.pending || '';
  const result = pendingId ? await adsApi<Pending>(`/oauth/pending/${encodeURIComponent(pendingId)}`) : null;

  if (!result || !result.ok) {
    return (
      <div className="cx-page">
        <PageHeader kicker="Ads" title="Choose ad accounts" backHref="/ads" backLabel="← Ads" />
        <section className="cx-panel">
          <p className="cx-help">
            {result && result.reason !== 'not_found'
              ? result.message
              : 'This connection expired or was already finished. Connect again to choose accounts.'}
          </p>
          <div className="cx-actions">
            <Link href="/ads" className="btn-cta">Back to Ads</Link>
          </div>
        </section>
      </div>
    );
  }

  const pending = result.data;
  const available = pending.accounts.filter((a) => !a.alreadyConnected);
  const name = platformName(pending.platform);

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Ads"
        title={`Choose ${name} accounts for ${pending.client.name}`}
        lede={`Your ${name} login can reach ${pending.accounts.length} ad accounts. Pick the ones that belong to this site. Nothing changes in your ad accounts.`}
        backHref="/ads"
        backLabel="← Ads"
      />

      {params.error === 'none' ? (
        <p className="cx-banner cx-banner-warn" role="status">Choose at least one account.</p>
      ) : params.error ? (
        <p className="cx-banner cx-banner-warn" role="status">{params.error}</p>
      ) : null}

      <form action={chooseAccounts} className="cx-panel">
        <input type="hidden" name="pending" value={pending.id} />
        <ul className="cx-account-list">
          {pending.accounts.map((account) => (
            <li key={account.externalId}>
              <label className="cx-account-option">
                <input
                  type="checkbox"
                  name="account"
                  value={account.externalId}
                  defaultChecked={account.alreadyConnected}
                  disabled={account.alreadyConnected}
                />
                <span>
                  <strong>{account.name}</strong>
                  <span className="cx-card-meta">
                    {[account.detail, `ID ${account.externalId}`, account.currency, account.alreadyConnected ? 'Already connected' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {available.length === 0 ? (
          <p className="cx-help">Every account on this login is already connected to this site.</p>
        ) : (
          <div className="cx-actions">
            <SubmitButton className="btn-cta" pendingLabel="Connecting…">Connect selected accounts</SubmitButton>
            <Link href="/ads" className="btn-secondary">Cancel</Link>
          </div>
        )}
      </form>
    </div>
  );
}
