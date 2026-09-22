import { inngest } from '../client';
import { getStore } from '@brain/lib/db/stores';
import { listCatalogResources } from '@brain/lib/db/catalog';
import { listGscRows } from '@brain/lib/db/gsc';
import { upsertOpenFinding, listOpenFindings } from '@brain/lib/db/findings';
import { logEvent } from '@brain/lib/brain/events';

function median(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

export const auditFn = inngest.createFunction(
  { id: 'seo-audit', retries: 1, triggers: [{ event: 'seo/audit.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    await step.run('run-audit', async () => {
      const catalog = await listCatalogResources(storeId, 1000);
      const gsc = await listGscRows(storeId, 2000);
      const byShopify: Record<string, any> = {};
      catalog.forEach((c: any) => { byShopify[c.shopifyId] = c; });

      const gscMapped: any[] = [];
      for (const row of gsc) {
        // map page url rough
        let rt: any = null, h: any = null;
        const p = (row.page || '').replace(/https?:\/\/[^/]+/, '');
        if (p.startsWith('/collections/')) { rt = 'collection'; h = p.split('/')[2]; }
        else if (p.startsWith('/pages/')) { rt = 'page'; h = p.split('/')[2]; }
        else if (p.startsWith('/blogs/')) { rt = 'article'; h = p.split('/').pop(); }
        const cat = catalog.find((c: any) => c.resourceType === rt && c.handle === h);
        gscMapped.push({ ...row, resourceType: rt, handle: h, catalog: cat || null });
      }

      const counts: Record<string, number> = {};
      const emit = async (f: any) => {
        const id = await upsertOpenFinding(f);
        if (id) counts[f.kind] = (counts[f.kind] || 0) + 1;
      };

      // catalog only
      for (const c of catalog) {
        if (c.resourceType === 'collection' && (c.productCount || 0) === 0) {
          await emit({ storeId, shopifyId: c.shopifyId, handle: c.handle, resourceType: c.resourceType, kind: 'no_products', severity: 'med', title: `Collection has 0 products: ${c.title}` });
        }
        const mfs = c.metafields || {};
        const placementEmpty = Object.keys(mfs).length === 0; // simplistic for empty_slot
        if (placementEmpty) {
          await emit({ storeId, shopifyId: c.shopifyId, handle: c.handle, resourceType: c.resourceType, kind: 'empty_slot', severity: 'low', title: `Possible empty placement slot for ${c.title}` });
        }
        if (!c.seoTitle || (c.seoTitle || '').length < 10 || !c.seoDescription || (c.seoDescription || '').length < 20) {
          await emit({ storeId, shopifyId: c.shopifyId, handle: c.handle, resourceType: c.resourceType, kind: 'thin', severity: 'low', title: `Thin SEO meta for ${c.title}` });
        }
      }

      // GSC based
      const imps = gscMapped.filter((g: any) => g.impressions >= 50).map((g: any) => g.impressions);
      const med = median(imps);
      for (const g of gscMapped) {
        if (g.impressions >= 50 && g.position >= 4 && g.position <= 20) {
          await emit({ storeId, shopifyId: g.catalog?.shopifyId || null, handle: g.handle || g.page, resourceType: g.resourceType || 'unknown', kind: 'striking_distance', severity: 'high', title: `Striking distance: ${g.query}`, detail: { query: g.query, pos: g.position, impressions: g.impressions } });
        }
        const lowCtr = g.impressions >= 100 && (g.ctr < 0.02 || (med > 0 && g.impressions > med && g.ctr < 0.015));
        if (lowCtr) {
          await emit({ storeId, shopifyId: g.catalog?.shopifyId || null, handle: g.handle || g.page, resourceType: g.resourceType || 'unknown', kind: 'low_ctr', severity: 'med', title: `Low CTR: ${g.query}`, detail: { ctr: g.ctr, impressions: g.impressions } });
        }
        if (g.impressions >= 50 && !g.catalog) {
          await emit({ storeId, shopifyId: null, handle: g.handle || g.page, resourceType: g.resourceType || 'unknown', kind: 'content_gap', severity: 'high', title: `Content gap for query ${g.query}`, detail: { query: g.query, page: g.page, impressions: g.impressions } });
        }
      }

      // cannibalization simple
      const byQuery: Record<string, any[]> = {};
      for (const g of gscMapped) {
        if ((g.impressions || 0) >= 20) {
          (byQuery[g.query] ||= []).push(g);
        }
      }
      for (const [q, list] of Object.entries(byQuery)) {
        const urls = new Set(list.map((x: any) => x.page));
        if (urls.size >= 2) {
          await emit({ storeId, shopifyId: null, handle: q, resourceType: 'multiple', kind: 'cannibalization', severity: 'med', title: `Cannibalization on "${q}"`, detail: { query: q, pages: Array.from(urls).slice(0,5) } });
        }
      }

      await logEvent(storeId, 'system', 'seo.audit.completed', { counts, totalOpen: (await listOpenFindings(storeId)).length });
      return { counts };
    });
  }
);
