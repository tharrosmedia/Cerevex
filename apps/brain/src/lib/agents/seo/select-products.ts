export function selectProductsForCollection({ storeId, keyword = '', brief, candidateProducts = [], llmSelectedIds = [], max }: { storeId: string; keyword?: string; brief?: any; candidateProducts?: any[]; llmSelectedIds?: string[]; max?: number }) {
  const k = keyword.toLowerCase();
  const planIds = (brief?.productPlan?.selectedProductIds || []);
  const planSet = new Set(planIds);
  const llmSet = new Set([...(llmSelectedIds || []), ...planIds]);
  const seen = new Set<string>();
  let ranked: any[] = [];

  for (const p of (candidateProducts || [])) {
    if (!p || !p.shopifyId || seen.has(p.shopifyId)) continue;
    seen.add(p.shopifyId);
    const text = ((p.title || '') + ' ' + (p.handle || '') + ' ' + (p.productType || '') + ' ' + ((p.tags || []).join(' '))).toLowerCase();
    let score = 0;
    if (k && text.includes(k)) score += 10;
    if (planSet.has(p.shopifyId)) score += 10; // strong seed from brief.productPlan
    else if (llmSet.has(p.shopifyId)) score += 5;
    ranked.push({ shopifyId: p.shopifyId, title: p.title, handle: p.handle, imageUrl: p.imageUrl, score });
  }

  ranked.sort((a, b) => b.score - a.score);

  let selected = ranked.map(r => ({ shopifyId: r.shopifyId, title: r.title, handle: r.handle, imageUrl: r.imageUrl }));
  if (typeof max === 'number' && max > 0) {
    selected = selected.slice(0, max);
  }
  const warnings: string[] = selected.length === 0 ? ['no matching products'] : [];
  return { selected, warnings };
}
