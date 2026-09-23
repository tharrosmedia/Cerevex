import { getStore, updateStore } from '@/src/lib/db/stores';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';

async function update(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const name = formData.get('name') as string;
  const shopify_domain = formData.get('shopify_domain') as string;
  const shopify_access_token = formData.get('shopify_access_token') as string;
  const platform = (formData.get('platform') as string) || 'shopify';
  let config: any = undefined;
  const configStr = formData.get('config') as string;
  if (configStr && configStr.trim()) {
    try { config = JSON.parse(configStr); } catch {}
  }
  if (!name || !shopify_domain) {
    redirect(`/stores/${id}/edit?error=missing`);
  }
  await updateStore(id, { name, shopify_domain, shopify_access_token: shopify_access_token || '', platform, config });
  revalidatePath('/stores');
  redirect('/stores?updated=1');
}

export default async function EditStore({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  let store: any = null;
  try { store = await getStore(id); } catch {}
  if (!store) {
    return (
      <div className="cx-page">
        <PageHeader title="Store not found" backHref="/stores" backLabel="← Stores" />
        <p className="cx-help">That store is gone or the id is wrong.</p>
        <Link href="/stores" className="btn-cta">Back to stores</Link>
      </div>
    );
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Stores"
        title={`Edit ${store.name}`}
        lede="Update store identity and credentials. Leave the token blank to keep the current one."
        backHref="/stores"
        backLabel="← Stores"
      />

      {sp.error === 'missing' ? (
        <p className="cx-banner cx-banner-warn" role="status">Name and domain are required.</p>
      ) : null}

      <section className="cx-panel" style={{ maxWidth: '40rem' }}>
        <form action={update} className="cx-form">
          <input type="hidden" name="id" value={id} />
          <div className="cx-field">
            <label htmlFor="edit-name">Name</label>
            <input id="edit-name" name="name" defaultValue={store.name} required />
          </div>
          <div className="cx-field">
            <label htmlFor="edit-domain">Shopify domain</label>
            <input id="edit-domain" name="shopify_domain" defaultValue={store.shopify_domain} required />
          </div>
          <div className="cx-field">
            <label htmlFor="edit-platform">Platform</label>
            <select id="edit-platform" name="platform" defaultValue={store.platform || 'shopify'}>
              <option value="shopify">Shopify</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="cx-field">
            <label htmlFor="edit-token">Access token</label>
            <input id="edit-token" name="shopify_access_token" type="password" placeholder="Leave blank to keep existing" />
            <p className="cx-help">Paste a new token only if you need to replace the saved one.</p>
          </div>
          <div className="cx-field">
            <label htmlFor="edit-config">Config (JSON, optional)</label>
            <textarea id="edit-config" name="config" defaultValue={store.config ? JSON.stringify(store.config, null, 2) : ''} />
          </div>
          <button type="submit" className="btn-cta">Save changes</button>
        </form>
      </section>
    </div>
  );
}
