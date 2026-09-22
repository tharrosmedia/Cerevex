import { getStore, updateStore } from '@/src/lib/db/stores';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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
  if (!store) return <div className="p-8">Store not found. <Link href="/stores">Back</Link></div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link href="/stores" className="underline">← Back to Stores</Link>
      <h1 className="text-2xl font-bold my-4">Edit Store: {store.name}</h1>

      {sp.error === 'missing' && <div className="mb-4 p-2 bg-red-100 text-red-700">Missing required fields.</div>}

      <form action={update} className="space-y-3 border p-4 rounded">
        <input type="hidden" name="id" value={id} />
        <div>
          <label className="block text-sm">Name</label>
          <input name="name" defaultValue={store.name} className="border p-2 w-full" required />
        </div>
        <div>
          <label className="block text-sm">Shopify Domain</label>
          <input name="shopify_domain" defaultValue={store.shopify_domain} className="border p-2 w-full" required />
        </div>
        <div>
          <label className="block text-sm">Platform</label>
          <select name="platform" defaultValue={store.platform || 'shopify'} className="border p-2 w-full">
            <option value="shopify">Shopify</option>
            <option value="woocommerce">WooCommerce</option>
            <option value="other">Other</option>
          </select>
        </div>
         <div>
           <label className="block text-sm">Access Token (leave blank to keep existing)</label>
           <input name="shopify_access_token" type="password" placeholder="shpat_... (optional to update)" className="border p-2 w-full" />
         </div>
         <div>
           <label className="block text-sm">Config (JSON, optional)</label>
           <textarea name="config" defaultValue={store.config ? JSON.stringify(store.config, null, 2) : ''} className="border p-2 w-full h-24 font-mono text-sm" />
         </div>
         <Button type="submit">Save Changes</Button>
      </form>
    </div>
  );
}
