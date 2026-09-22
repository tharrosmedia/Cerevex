import { listDrafts } from '@/src/lib/db/drafts';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';

export const dynamic = 'force-dynamic';

export default async function Review({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const params = await searchParams;
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
  let drafts: any[] = [];
  let loadError: string | null = null;
  try {
    if (storeId) {
      drafts = await listDrafts(storeId, undefined, 20);
    }
  } catch (e: any) {
    loadError = e.message || 'Failed to load drafts';
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Review Queue</h1>
      <Link href="/" className="underline mb-4 block">Back to Dashboard</Link>

      {params.success === 'decision-submitted' && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">
          Decision submitted! Publishing to Shopify (usually under 30s). Check job status or Shopify admin.
        </div>
      )}

      {loadError && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Error: {loadError}</div>}

      <table className="w-full border">
        <thead>
          <tr>
            <th className="p-2 text-left">Title</th>
            <th className="p-2 text-left">Type</th>
            <th className="p-2 text-left">Handle</th>
            <th className="p-2 text-left">Created</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {drafts.length === 0 && !loadError && <tr><td colSpan={5} className="p-4 text-muted-foreground">No recent drafts</td></tr>}
          {drafts.map((d: any) => (
            <tr key={d.id} className="border-t">
              <td className="p-2">{d.title}</td>
              <td className="p-2">{d.type}</td>
              <td className="p-2">{d.handle}</td>
              <td className="p-2 text-sm">{new Date(d.createdAt).toLocaleString()}</td>
              <td className="p-2 space-x-2">
                <Link href={`/drafts/${d.id}`} className="underline">View &amp; Decide</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
