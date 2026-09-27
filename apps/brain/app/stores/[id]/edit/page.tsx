import { getStore, updateStore } from '@/src/lib/db/stores';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { SubmitButton } from '@/components/submit-button';
import { platformLabel } from '@/lib/labels';
import { normalizeShopDomain, verifyShopifyConnection } from '@/src/lib/shopify/verify';
import { isWordpressStore } from '@/src/lib/wordpress';

function editUrl(id: string, error: string) {
  return `/stores/${id}/edit?error=${encodeURIComponent(error)}`;
}

async function update(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '');
  const store = await getStore(id);
  if (!store) redirect('/stores');
  const name = String(formData.get('name') || '').trim();
  if (!name) redirect(editUrl(id, 'Enter a name.'));

  const wordpress = isWordpressStore(store);
  const platform = wordpress ? 'wordpress' : 'shopify';
  let shopifyDomain = store.shopify_domain;
  const token = String(formData.get('shopify_access_token') || '').trim();

  if (!wordpress) {
    const domain = normalizeShopDomain(String(formData.get('shopify_domain') || ''));
    if (!domain) redirect(editUrl(id, 'Enter your store address, like mystore.myshopify.com.'));
    if (domain !== store.shopify_domain || token) {
      const check = await verifyShopifyConnection(domain, token || store.shopify_access_token);
      if (!check.ok) redirect(editUrl(id, `Not saved. ${check.error}`));
    }
    shopifyDomain = domain;
  }

  let config = store.config || {};
  const configStr = String(formData.get('config') ?? '');
  const configOriginal = String(formData.get('config_original') ?? '');
  if (formData.has('config') && configStr.trim() && configStr !== configOriginal) {
    try {
      const parsed = JSON.parse(configStr);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      config = parsed;
    } catch {
      redirect(editUrl(id, 'Not saved. Advanced settings must be valid JSON (an object).'));
    }
  }

  await updateStore(id, {
    name,
    shopify_domain: shopifyDomain,
    shopify_access_token: wordpress ? '' : token,
    platform,
    connector_type: platform,
    config,
  });
  revalidatePath('/stores');
  redirect('/stores?updated=1');
}

export default async function EditStore({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  let store: any = null;
  let loadError: string | null = null;
  try { store = await getStore(id); } catch (e: any) { loadError = e?.message || 'Could not load this store.'; }
  if (!store) {
    return (
      <div className="cx-page">
        <PageHeader title={loadError ? 'Could not load store' : 'Store not found'} backHref="/stores" backLabel="← Stores" />
        <p className="cx-help">{loadError || 'That store was removed or the link is wrong.'}</p>
        <Link href="/stores" className="btn-cta">Back to stores</Link>
      </div>
    );
  }
  const wordpress = isWordpressStore(store);
  const configJson = store.config ? JSON.stringify(store.config, null, 2) : '';

  return (
    <div className="cx-page">
      <PageHeader
        kicker={platformLabel(wordpress ? 'wordpress' : 'shopify')}
        title={`Edit ${store.name}`}
        backHref="/stores"
        backLabel="← Stores"
      />

      {sp.error ? <p className="cx-banner cx-banner-warn" role="status">{sp.error}</p> : null}

      <section className="cx-panel cx-narrow">
        <form action={update} className="cx-form">
          <input type="hidden" name="id" value={id} />
          <div className="cx-field">
            <label htmlFor="edit-name">Name</label>
            <input id="edit-name" name="name" defaultValue={store.name} required />
          </div>
          {wordpress ? (
            <p className="cx-help">
              Site address: {store.shopify_domain}. To change the address or plugin key, reconnect WordPress in{' '}
              <Link href="/settings#connects">Settings</Link>.
            </p>
          ) : (
            <>
              <div className="cx-field">
                <label htmlFor="edit-domain">Store address</label>
                <input id="edit-domain" name="shopify_domain" defaultValue={store.shopify_domain} required />
              </div>
              <div className="cx-field">
                <label htmlFor="edit-token">Admin API access token</label>
                <input id="edit-token" name="shopify_access_token" type="password" autoComplete="off" placeholder="Leave blank to keep the current token" />
                <p className="cx-help">A new token or address is checked with Shopify before it&apos;s saved.</p>
              </div>
            </>
          )}
          <details className="cx-details">
            <summary>Advanced settings (JSON)</summary>
            <p className="cx-help">
              Raw settings for this store, including content placement rules. Leave unchanged unless you know what you&apos;re editing.
            </p>
            <div className="cx-field">
              <label htmlFor="edit-config">Settings JSON</label>
              <textarea id="edit-config" name="config" rows={12} className="font-mono text-xs" defaultValue={configJson} />
              <input type="hidden" name="config_original" value={configJson} />
            </div>
          </details>
          <SubmitButton className="btn-cta" pendingLabel="Saving…">Save changes</SubmitButton>
        </form>
      </section>
    </div>
  );
}
