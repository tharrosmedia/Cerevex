import Link from 'next/link';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { listGscRows } from '@/src/lib/db/gsc';
import { isGscConfigured } from '@/src/lib/gsc/client';
import { Button } from '@/components/ui/button';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';

async function syncGsc() {
  'use server';
  const storeId = await getActiveStoreId();
  if (storeId) {
    await inngest.send({ name: 'seo/gsc.sync.requested', data: { storeId } });
    revalidatePath('/seo/search');
  }
}

export const dynamic = 'force-dynamic';

export default async function SeoSearch() {
  const storeId = await getActiveStoreId();
  const store = storeId ? await getStore(storeId) : null;
  const gsc = store?.config?.gsc || {};
  let rows: any[] = [];
  try { if (storeId) rows = await listGscRows(storeId, 200); } catch {}
  const connected = !!gsc.refreshTokenEnc;
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/seo" className="underline">← Overview</Link>
      <h1 className="text-2xl font-bold mt-4">Search Console</h1>
      {!isGscConfigured() && <div className="text-red-600">GSC OAuth not configured on this host.</div>}
      <div className="my-4 text-sm">
        Status: {connected ? 'Connected' : 'Not connected'} {gsc.propertyUrl ? `(${gsc.propertyUrl})` : ''} {gsc.lastSyncedAt ? `last: ${new Date(gsc.lastSyncedAt).toLocaleString()}` : ''}
      </div>
      <form action={syncGsc} className="mb-4"><Button type="submit" variant="outline">Sync 28 days</Button></form>
      <table className="w-full border text-sm">
        <thead><tr className="bg-muted"><th className="p-2">Query</th><th>Page</th><th>Clicks</th><th>Impr</th><th>CTR</th><th>Pos</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">No GSC data. Connect in Settings and sync.</td></tr>}
          {rows.map((r: any, i: number) => (
            <tr key={i} className="border-t">
              <td className="p-2">{r.query}</td>
              <td className="p-2 font-mono text-xs truncate max-w-[240px]">{r.page}</td>
              <td>{r.clicks}</td><td>{r.impressions}</td>
              <td>{(r.ctr * 100).toFixed(1)}%</td><td>{r.position?.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs">Filter by resource type added with findings. Rows from last sync.</p>
    </div>
  );
}
