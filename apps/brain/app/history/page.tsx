import { listJobs } from '@/src/lib/db/jobs';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId, getStore } from '@/src/lib/db/stores';

export const dynamic = 'force-dynamic';

export default async function History() {
  let storeId = await getActiveStoreId();
  const cookieStore = await cookies();
  if (!storeId) {
    const stores = await listStores();
    if (stores.length > 0) {
      storeId = stores[0].id;
      if (storeId) {
        cookieStore.set('activeStoreId', storeId, {
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      }
    }
  }
  let jobs: any[] = [];
  let loadError: string | null = null;
  let domain = 'your-store.myshopify.com';
  try {
    if (storeId) {
      jobs = await listJobs(storeId, 50);
      const s = await getStore(storeId);
      if (s?.shopify_domain) domain = s.shopify_domain;
    }
  } catch (e: any) {
    loadError = e.message || 'Failed to load history';
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/" className="underline">← Dashboard</Link>
      <h1 className="text-2xl font-bold my-6">Job History</h1>

      {loadError && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Error: {loadError}</div>}

      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-muted">
            <th className="p-2 text-left">ID</th>
            <th className="p-2 text-left">Type</th>
            <th className="p-2 text-left">Input</th>
            <th className="p-2">Status</th>
            <th className="p-2">Created</th>
            <th className="p-2">Output</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && !loadError && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No jobs yet.</td></tr>}
          {jobs.map((j: any) => (
            <tr key={j.id} className="border-t">
              <td className="p-2 font-mono">{j.id.slice(0,8)}</td>
              <td className="p-2">{j.type}</td>
              <td className="p-2">{JSON.stringify(j.input)}</td>
              <td className="p-2 text-center">{j.status}</td>
              <td className="p-2">{new Date(j.createdAt).toLocaleDateString()}</td>
              <td className="p-2 text-xs max-w-xs">
                {j.output ? (
                  <>
                    <div className="truncate">{JSON.stringify(j.output).slice(0,80)}</div>
                    {(() => {
                      const out = j.output?.data || j.output;
                      const coll = out?.collectionCreate?.collection || out?.pageUpdate?.page || out?.pageCreate?.page;
                      const art = out?.articleCreate?.article;
                      const pg = out?.pageCreate?.page || out?.pageUpdate?.page;
                      const adminSlug = domain.replace(/\.myshopify\.com$/, '');
                      const links: string[] = [];
                      if (coll?.handle) links.push(`SF: /collections/${coll.handle}`);
                      if (coll?.id) { const n = String(coll.id).split('/').pop(); if (n) links.push(`Admin: /collections/${n}`); }
                      if (pg?.handle) links.push(`SF: /pages/${pg.handle}`);
                      if (pg?.id) { const n = String(pg.id).split('/').pop(); if (n) links.push(`Admin: /pages/${n}`); }
                      if (art?.handle) links.push(`SF: /blogs/blog/${art.handle}`);
                      if (art?.id) { const n = String(art.id).split('/').pop(); if (n) links.push(`Admin: /articles/${n}`); }
                      return links.length ? <div className="text-[10px] mt-0.5 text-blue-600">{links.join(' | ')}</div> : null;
                    })()}
                  </>
                ) : '-'}
              </td>
              <td className="p-2"><Link href={`/jobs/${j.id}`} className="underline">View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
