import { GSC_REC_TYPE_LABELS, type GscRecTypeId } from './gsc-copy';
import { parsePositionThreshold } from './gsc-threshold';

export const GSC_REC_KINDS = ['gsc_u', 'gsc_n', 'gsc_c', 'gsc_a'] as const;
export type GscRecKind = (typeof GSC_REC_KINDS)[number];

export const GSC_MIN_IMPRESSIONS = 50;
export const GSC_MAX_OPEN_RECS = 20;

export type GscRowInput = {
  query?: string | null;
  page?: string | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

export type GscCatalogInput = {
  id?: string | null;
  shopifyId?: string | null;
  resourceType?: string | null;
  handle?: string | null;
  title?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  bodyHtml?: string | null;
};

export type GscRecommendation = {
  recType: GscRecKind;
  clusterKey: string;
  title: string;
  why: string;
  discrepancy: string | null;
  severity: 'high' | 'med' | 'low';
  score: number;
  handle: string;
  resourceType: string;
  shopifyId: string | null;
  catalogId: string | null;
  page: string | null;
  query: string | null;
  queries: string[];
  pages: string[];
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  threshold: number;
  croSignals: string[];
  offerIntent: string | null;
  keeperUrl: string | null;
};

export type GenerateGscRecommendationsInput = {
  rows: GscRowInput[];
  catalog: GscCatalogInput[];
  positionThreshold?: number;
  minImpressions?: number;
  maxOpenRecs?: number;
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'for', 'to', 'of', 'and', 'or', 'near', 'me', 'my',
  'your', 'our', 'with', 'from', 'at', 'by', 'is', 'are', 'was', 'be', 'this', 'that',
]);

const COMMERCIAL_TERMS = new Set([
  'service', 'services', 'product', 'products', 'quote', 'quotes', 'install', 'installation',
  'repair', 'repairs', 'buy', 'cost', 'price', 'prices', 'estimate', 'book', 'booking',
  'schedule', 'emergency', 'replacement', 'replace', 'tune', 'maintenance', 'contact',
  'hvac', 'ac', 'furnace', 'heat', 'heating', 'pump', 'ductless', 'mini', 'split',
  'thermostat', 'financing', 'coupon', 'deal', 'sale', 'cooling', 'air', 'conditioner',
  'conditioning', 'lead', 'leads', 'call', 'appointment', 'same-day', 'sameday',
]);

const LEAD_TERMS = new Set([
  'quote', 'quotes', 'estimate', 'book', 'booking', 'schedule', 'contact', 'call',
  'appointment', 'emergency', 'financing', 'near',
]);

const VANITY_TERMS = new Set([
  'what', 'why', 'how', 'versus', 'history', 'definition', 'meaning', 'wiki',
  'explained', 'types',
]);

const MONEY_PATH_RE = /\/(collections|products|services|contact|quote|book|schedule|financing|repair|install)\b/i;

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractH1(html: string): string {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html || '');
  return match ? stripHtml(match[1]) : '';
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function queryClusterKey(query: string): string {
  return normalizeQuery(query)
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token))
    .sort()
    .join(' ');
}

export function tokenize(text: string): Set<string> {
  return new Set(
    normalizeQuery(text)
      .split(' ')
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const token of a) if (b.has(token)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

export function normalizePageUrl(page: string | null | undefined): string {
  if (!page) return '';
  try {
    const url = new URL(page, 'https://example.com');
    let path = url.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path || '/';
  } catch {
    const raw = String(page).replace(/https?:\/\/[^/]+/i, '');
    const path = raw.split('?')[0] || '/';
    return path.length > 1 ? path.replace(/\/+$/, '') : '/';
  }
}

export function isHomePath(path: string): boolean {
  return path === '/' || path === '' || path === '/index' || path === '/index.html';
}

export function isMoneyUrl(path: string, resourceType?: string | null): boolean {
  if (resourceType === 'collection' || resourceType === 'product') return true;
  if (MONEY_PATH_RE.test(path)) return true;
  return /contact|quote|book|schedule|service|repair|install|financing/.test(path);
}

export function parsePageResource(path: string): { resourceType: string; handle: string } {
  if (path.startsWith('/collections/')) return { resourceType: 'collection', handle: path.split('/')[2] || path };
  if (path.startsWith('/products/')) return { resourceType: 'product', handle: path.split('/')[2] || path };
  if (path.startsWith('/pages/')) return { resourceType: 'page', handle: path.split('/')[2] || path };
  if (path.startsWith('/blogs/')) return { resourceType: 'article', handle: path.split('/').filter(Boolean).pop() || path };
  const handle = path.split('/').filter(Boolean).pop() || path || '/';
  return { resourceType: 'unknown', handle };
}

function matchCatalog(path: string, catalog: GscCatalogInput[]): GscCatalogInput | null {
  const parsed = parsePageResource(path);
  const byHandle = catalog.find((item) => {
    if (!item.handle || item.handle !== parsed.handle) return false;
    if (parsed.resourceType === 'unknown') return true;
    if (item.resourceType === parsed.resourceType) return true;
    if (parsed.resourceType === 'page' && item.resourceType === 'wp_page') return true;
    if (parsed.resourceType === 'article' && (item.resourceType === 'wp_post' || item.resourceType === 'article')) return true;
    return false;
  });
  if (byHandle) return byHandle;
  return catalog.find((item) => item.handle && path.endsWith(`/${item.handle}`)) || null;
}

function intentScore(text: string): { commercial: number; lead: number; vanity: number } {
  const tokens = tokenize(text);
  let commercial = 0;
  let lead = 0;
  let vanity = 0;
  for (const token of tokens) {
    if (COMMERCIAL_TERMS.has(token)) commercial += 1;
    if (LEAD_TERMS.has(token)) lead += 1;
    if (VANITY_TERMS.has(token)) vanity += 1;
  }
  const size = Math.max(1, tokens.size);
  return { commercial: commercial / size, lead: lead / size, vanity: vanity / size };
}

function expectedCtr(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.11;
  if (position <= 5) return 0.07;
  if (position <= 8) return 0.04;
  return 0.025;
}

export function isWeakCtr(ctr: number, impressions: number, position: number): boolean {
  if (impressions < 100) return false;
  return ctr < 0.02 || ctr < expectedCtr(position) * 0.45;
}

function pageText(catalog: GscCatalogInput | null, path: string): { topic: string; text: string } {
  const parsed = parsePageResource(path);
  const title = catalog?.title || catalog?.seoTitle || parsed.handle.replace(/[-_]+/g, ' ');
  const h1 = catalog?.bodyHtml ? extractH1(catalog.bodyHtml) : '';
  const body = catalog?.bodyHtml ? stripHtml(catalog.bodyHtml).slice(0, 400) : '';
  const seo = [catalog?.seoTitle, catalog?.seoDescription].filter(Boolean).join(' ');
  return {
    topic: (h1 || title || parsed.handle).replace(/[-_]+/g, ' ').trim() || 'this page',
    text: [title, h1, seo, body].filter(Boolean).join(' '),
  };
}

export function nameDiscrepancy(queries: string[], pageTopic: string, pageTextValue: string): {
  glaring: boolean;
  confidence: number;
  sentence: string | null;
} {
  const topQuery = queries[0] || '';
  const queryTokens = tokenize(queries.slice(0, 5).join(' '));
  const pageTokens = tokenize(pageTextValue);
  if (queryTokens.size < 2) return { glaring: false, confidence: 0, sentence: null };
  const overlap = tokenOverlap(queryTokens, pageTokens);
  const queryIntent = intentScore(queries.join(' '));
  const pageIntent = intentScore(pageTextValue);
  const intentMismatch = queryIntent.commercial + queryIntent.lead > 0.12 && pageIntent.vanity > 0.12 && pageIntent.commercial < 0.08;
  let confidence = Math.max(0, 1 - overlap);
  if (intentMismatch) confidence = Math.min(1, confidence + 0.25);
  const glaring = (overlap < 0.35 && confidence >= 0.45) || (intentMismatch && overlap < 0.55);
  if (!glaring) return { glaring: false, confidence, sentence: null };
  const sentence = `People searching “${topQuery}” land on a page about ${pageTopic} that does not answer or convert for that search.`;
  return { glaring: true, confidence, sentence };
}

function quoteList(values: string[], max = 2): string {
  return values.slice(0, max).map((value) => `“${value}”`).join(' and ');
}

function croWeight(input: {
  queryText: string;
  path: string;
  resourceType?: string | null;
  ctr: number;
  impressions: number;
  position: number;
  wouldCreateMoneyPage?: boolean;
}): { weight: number; penalty: number; signals: string[] } {
  const intent = intentScore(input.queryText);
  const signals: string[] = [];
  let weight = 0.45;
  if (intent.commercial > 0.08 || intent.lead > 0.05) {
    weight += 0.7;
    signals.push('commercial or lead search');
  }
  if (isMoneyUrl(input.path, input.resourceType) || input.wouldCreateMoneyPage) {
    weight += 0.55;
    signals.push('money or lead page');
  }
  if (isWeakCtr(input.ctr, input.impressions, input.position)) {
    weight += 0.5;
    signals.push('people see this but rarely click');
  }
  let penalty = 0;
  if (intent.vanity > 0.15 && intent.commercial < 0.05 && intent.lead < 0.04) {
    penalty += input.impressions * 0.35;
    signals.push('informational search with little path to a lead');
  }
  return { weight, penalty, signals };
}

function severityFromScore(score: number): 'high' | 'med' | 'low' {
  if (score >= 400) return 'high';
  if (score >= 120) return 'med';
  return 'low';
}

type PageAgg = {
  page: string;
  path: string;
  impressions: number;
  clicks: number;
  positionWeight: number;
  queries: Map<string, { impressions: number; clicks: number; position: number; ctr: number }>;
  catalog: GscCatalogInput | null;
  parsed: { resourceType: string; handle: string };
};

type QueryAgg = {
  query: string;
  cluster: string;
  impressions: number;
  clicks: number;
  pages: Map<string, { impressions: number; clicks: number; position: number; ctr: number }>;
};

function aggregateRows(rows: GscRowInput[], catalog: GscCatalogInput[]): { pages: PageAgg[]; queries: QueryAgg[] } {
  const pages = new Map<string, PageAgg>();
  const queries = new Map<string, QueryAgg>();
  for (const row of rows) {
    const query = (row.query || '').trim();
    const page = (row.page || '').trim();
    if (!query && !page) continue;
    const impressions = asNumber(row.impressions);
    const clicks = asNumber(row.clicks);
    const position = asNumber(row.position);
    const ctr = row.ctr != null ? asNumber(row.ctr) : impressions > 0 ? clicks / impressions : 0;
    if (page) {
      const path = normalizePageUrl(page);
      const current = pages.get(path) || {
        page,
        path,
        impressions: 0,
        clicks: 0,
        positionWeight: 0,
        queries: new Map(),
        catalog: matchCatalog(path, catalog),
        parsed: parsePageResource(path),
      };
      current.impressions += impressions;
      current.clicks += clicks;
      current.positionWeight += position * impressions;
      if (query) {
        const q = current.queries.get(query) || { impressions: 0, clicks: 0, position: 0, ctr: 0 };
        q.impressions += impressions;
        q.clicks += clicks;
        q.position += position * impressions;
        current.queries.set(query, q);
      }
      pages.set(path, current);
    }
    if (query) {
      const cluster = queryClusterKey(query) || normalizeQuery(query);
      const current = queries.get(query) || {
        query,
        cluster,
        impressions: 0,
        clicks: 0,
        pages: new Map(),
      };
      current.impressions += impressions;
      current.clicks += clicks;
      if (page) {
        const p = current.pages.get(page) || { impressions: 0, clicks: 0, position: 0, ctr: 0 };
        p.impressions += impressions;
        p.clicks += clicks;
        p.position += position * impressions;
        current.pages.set(page, p);
      }
      queries.set(query, current);
    }
  }
  for (const page of pages.values()) {
    for (const q of page.queries.values()) {
      q.position = q.impressions > 0 ? q.position / q.impressions : 0;
      q.ctr = q.impressions > 0 ? q.clicks / q.impressions : 0;
    }
  }
  for (const query of queries.values()) {
    for (const p of query.pages.values()) {
      p.position = p.impressions > 0 ? p.position / p.impressions : 0;
      p.ctr = p.impressions > 0 ? p.clicks / p.impressions : 0;
    }
  }
  return { pages: [...pages.values()], queries: [...queries.values()] };
}

function topQueries(page: PageAgg, limit = 4): string[] {
  return [...page.queries.entries()]
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, limit)
    .map(([query]) => query);
}

function pagePosition(page: PageAgg): number {
  return page.impressions > 0 ? page.positionWeight / page.impressions : 0;
}

function pageCtr(page: PageAgg): number {
  return page.impressions > 0 ? page.clicks / page.impressions : 0;
}

function finishRec(partial: Omit<GscRecommendation, 'title' | 'severity'> & { title?: string }): GscRecommendation {
  return {
    ...partial,
    title: partial.title || GSC_REC_TYPE_LABELS[partial.recType as GscRecTypeId],
    severity: severityFromScore(partial.score),
  };
}

export function isGscRecKind(value: unknown): value is GscRecKind {
  return typeof value === 'string' && (GSC_REC_KINDS as readonly string[]).includes(value);
}

export function generateGscRecommendations(input: GenerateGscRecommendationsInput): GscRecommendation[] {
  const threshold = parsePositionThreshold(input.positionThreshold);
  const minImpressions = input.minImpressions ?? GSC_MIN_IMPRESSIONS;
  const maxOpen = input.maxOpenRecs ?? GSC_MAX_OPEN_RECS;
  const { pages, queries } = aggregateRows(input.rows || [], input.catalog || []);
  const candidates: GscRecommendation[] = [];
  const usedPages = new Set<string>();
  const usedQueryClusters = new Set<string>();

  for (const page of pages) {
    if (page.impressions < minImpressions) continue;
    const position = pagePosition(page);
    const ctr = pageCtr(page);
    const queriesForPage = topQueries(page);
    const queryText = queriesForPage.join(' ');
    const { topic, text } = pageText(page.catalog, page.path);
    const discrepancy = nameDiscrepancy(queriesForPage, topic, text);
    const cro = croWeight({
      queryText,
      path: page.path,
      resourceType: page.catalog?.resourceType || page.parsed.resourceType,
      ctr,
      impressions: page.impressions,
      position,
    });
    const vanityOnly = cro.signals.includes('informational search with little path to a lead') && !discrepancy.glaring && !isWeakCtr(ctr, page.impressions, position);
    if (vanityOnly && position <= threshold + 1.5) continue;

    if (discrepancy.glaring && discrepancy.sentence) {
      const gap = Math.max(0.2, position > threshold ? position - threshold : 0.4);
      const score = page.impressions * cro.weight * gap * Math.max(0.45, discrepancy.confidence) - cro.penalty;
      candidates.push(finishRec({
        recType: 'gsc_a',
        clusterKey: `a:${page.path}`,
        why: discrepancy.sentence,
        discrepancy: discrepancy.sentence,
        score,
        handle: page.catalog?.handle || page.parsed.handle,
        resourceType: page.catalog?.resourceType || page.parsed.resourceType,
        shopifyId: page.catalog?.shopifyId || `gsc:a:${page.path}`,
        catalogId: page.catalog?.id || null,
        page: page.page,
        query: queriesForPage[0] || null,
        queries: queriesForPage,
        pages: [page.page],
        impressions: page.impressions,
        clicks: page.clicks,
        ctr,
        position,
        threshold,
        croSignals: cro.signals,
        offerIntent: null,
        keeperUrl: null,
      }));
      usedPages.add(page.path);
      continue;
    }

    if (position > threshold) {
      const gap = Math.max(0.25, position - threshold);
      const tinyGapNoStory = gap < 0.6 && !isWeakCtr(ctr, page.impressions, position) && cro.weight < 0.8;
      if (tinyGapNoStory) continue;
      const score = page.impressions * cro.weight * (1 + gap / 5) - cro.penalty;
      if (score <= 0) continue;
      const top = queriesForPage[0] || 'this search';
      candidates.push(finishRec({
        recType: 'gsc_u',
        clusterKey: `u:${page.path}`,
        why: `People searching ${quoteList(queriesForPage)} land on this page, but it is not converting that demand as well as it should.`,
        discrepancy: null,
        score,
        handle: page.catalog?.handle || page.parsed.handle,
        resourceType: page.catalog?.resourceType || page.parsed.resourceType,
        shopifyId: page.catalog?.shopifyId || `gsc:u:${page.path}`,
        catalogId: page.catalog?.id || null,
        page: page.page,
        query: top,
        queries: queriesForPage,
        pages: [page.page],
        impressions: page.impressions,
        clicks: page.clicks,
        ctr,
        position,
        threshold,
        croSignals: cro.signals,
        offerIntent: null,
        keeperUrl: null,
      }));
      usedPages.add(page.path);
    }
  }

  const clusters = new Map<string, QueryAgg[]>();
  for (const query of queries) {
    const key = query.cluster || normalizeQuery(query.query);
    const list = clusters.get(key) || [];
    list.push(query);
    clusters.set(key, list);
  }

  for (const [cluster, group] of clusters) {
    const pagesForCluster = new Map<string, { impressions: number; clicks: number; position: number; query: string }>();
    let impressions = 0;
    let clicks = 0;
    const queryNames: string[] = [];
    for (const item of group) {
      impressions += item.impressions;
      clicks += item.clicks;
      queryNames.push(item.query);
      for (const [page, stats] of item.pages) {
        const path = normalizePageUrl(page);
        const current = pagesForCluster.get(path) || { impressions: 0, clicks: 0, position: 0, query: item.query };
        current.impressions += stats.impressions;
        current.clicks += stats.clicks;
        current.position += stats.position * stats.impressions;
        pagesForCluster.set(path, current);
      }
    }
    if (impressions < minImpressions) continue;
    const distinct = [...pagesForCluster.entries()].filter(([, stats]) => stats.impressions >= Math.min(20, minImpressions / 2));
    if (distinct.length < 2) continue;
    const ranked = distinct
      .map(([path, stats]) => {
        const page = pages.find((item) => item.path === path);
        const position = stats.impressions > 0 ? stats.position / stats.impressions : 0;
        const ctr = stats.impressions > 0 ? stats.clicks / stats.impressions : 0;
        const cro = croWeight({
          queryText: queryNames.join(' '),
          path,
          resourceType: page?.catalog?.resourceType || page?.parsed.resourceType,
          ctr,
          impressions: stats.impressions,
          position,
        });
        return { path, page, stats, position, ctr, cro, score: stats.impressions * cro.weight - cro.penalty };
      })
      .sort((a, b) => b.score - a.score);
    const keeper = ranked[0];
    const urls = ranked.map((item) => item.page?.page || item.path);
    const croSignals = [...new Set(ranked.flatMap((item) => item.cro.signals))];
    const score = impressions * (0.7 + (keeper.cro.weight - 0.45)) - keeper.cro.penalty;
    candidates.push(finishRec({
      recType: 'gsc_c',
      clusterKey: `c:${cluster}`,
      why: `More than one page is answering ${quoteList(queryNames)}. Keep ${keeper.path} — it is the stronger path to a lead or sale.`,
      discrepancy: null,
      score,
      handle: keeper.page?.catalog?.handle || keeper.page?.parsed.handle || keeper.path,
      resourceType: keeper.page?.catalog?.resourceType || keeper.page?.parsed.resourceType || 'multiple',
      shopifyId: keeper.page?.catalog?.shopifyId || `gsc:c:${cluster}`,
      catalogId: keeper.page?.catalog?.id || null,
      page: keeper.page?.page || keeper.path,
      query: queryNames[0] || null,
      queries: queryNames.slice(0, 5),
      pages: urls.slice(0, 5),
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: keeper.position,
      threshold,
      croSignals,
      offerIntent: null,
      keeperUrl: keeper.page?.page || keeper.path,
    }));
    usedQueryClusters.add(cluster);
  }

  for (const query of queries) {
    if (query.impressions < minImpressions) continue;
    if (usedQueryClusters.has(query.cluster)) continue;
    const landing = [...query.pages.entries()].sort((a, b) => b[1].impressions - a[1].impressions)[0];
    const landingPath = landing ? normalizePageUrl(landing[0]) : '';
    const landingPage = landingPath ? pages.find((item) => item.path === landingPath) : undefined;
    const { topic, text } = pageText(landingPage?.catalog || null, landingPath || '/');
    const discrepancy = nameDiscrepancy([query.query], topic, text);
    const hasCatalog = !!landingPage?.catalog;
    const weakLanding = !landing || isHomePath(landingPath) || !hasCatalog || (discrepancy.glaring && tokenOverlap(tokenize(query.query), tokenize(text)) < 0.25);
    if (!weakLanding) continue;
    const intent = intentScore(query.query);
    if (intent.vanity > 0.18 && intent.commercial < 0.05 && intent.lead < 0.04) continue;
    const cro = croWeight({
      queryText: query.query,
      path: '/pages/' + (query.cluster || 'new').replace(/\s+/g, '-'),
      ctr: query.impressions > 0 ? query.clicks / query.impressions : 0,
      impressions: query.impressions,
      position: landing?.[1].position || 12,
      wouldCreateMoneyPage: intent.commercial + intent.lead > 0.08,
    });
    const offerIntent = intent.lead > 0.05
      ? 'This new page should state the offer and a clear next step (quote, book, or call).'
      : intent.commercial > 0.08
        ? 'This new page should be built to convert that request — not just rank for it.'
        : null;
    if (!offerIntent && cro.weight < 0.8) continue;
    const score = query.impressions * cro.weight * (discrepancy.glaring ? Math.max(0.5, discrepancy.confidence) : 0.85) - cro.penalty;
    if (score <= 0) continue;
    candidates.push(finishRec({
      recType: 'gsc_n',
      clusterKey: `n:${query.cluster || normalizeQuery(query.query)}`,
      why: `People search “${query.query}”, and you do not have a page that can convert that request.`,
      discrepancy: discrepancy.glaring ? discrepancy.sentence : null,
      score,
      handle: (query.cluster || normalizeQuery(query.query)).replace(/\s+/g, '-'),
      resourceType: 'page',
      shopifyId: `gsc:n:${query.cluster || normalizeQuery(query.query)}`,
      catalogId: null,
      page: null,
      query: query.query,
      queries: [query.query],
      pages: landing ? [landing[0]] : [],
      impressions: query.impressions,
      clicks: query.clicks,
      ctr: query.impressions > 0 ? query.clicks / query.impressions : 0,
      position: landing?.[1].position || 0,
      threshold,
      croSignals: cro.signals,
      offerIntent: offerIntent || 'This new page should be built to convert that request — not just rank for it.',
      keeperUrl: null,
    }));
  }

  const deduped: GscRecommendation[] = [];
  const seen = new Set<string>();
  for (const rec of candidates.sort((a, b) => b.score - a.score)) {
    const key = `${rec.recType}:${rec.clusterKey}`;
    if (seen.has(key)) continue;
    if (rec.recType === 'gsc_u' && usedPages.has(normalizePageUrl(rec.page)) && candidates.some((other) => other.recType === 'gsc_a' && other.clusterKey === `a:${normalizePageUrl(rec.page)}`)) {
      continue;
    }
    seen.add(key);
    deduped.push(rec);
    if (deduped.length >= maxOpen) break;
  }
  return deduped;
}

export function gscRecommendationDetail(rec: GscRecommendation): Record<string, unknown> {
  return {
    recType: rec.recType,
    clusterKey: rec.clusterKey,
    why: rec.why,
    discrepancy: rec.discrepancy,
    queries: rec.queries,
    pages: rec.pages,
    page: rec.page,
    query: rec.query,
    impressions: rec.impressions,
    clicks: rec.clicks,
    ctr: rec.ctr,
    position: rec.position,
    threshold: rec.threshold,
    croSignals: rec.croSignals,
    offerIntent: rec.offerIntent,
    keeperUrl: rec.keeperUrl,
    score: rec.score,
  };
}
