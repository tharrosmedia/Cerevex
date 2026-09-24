import assert from 'node:assert/strict';
import {
  generateGscRecommendations,
  isGscRecKind,
  isWeakCtr,
  nameDiscrepancy,
  normalizePageUrl,
  queryClusterKey,
  tokenize,
  tokenOverlap,
} from '../src/lib/seo/gsc-recommendations';
import {
  GSC_DEFAULT_POSITION_THRESHOLD,
  gscApplyBlockedByKillSwitch,
  parsePositionThreshold,
  withGscStoreConfig,
} from '../src/lib/seo/gsc-threshold';
import { isGscSourcedJob } from '../src/lib/seo/gsc-flags';
import {
  GSC_POSITION_EDUCATION,
  GSC_REC_TYPE_LABELS,
  GSC_RECS_FLAG_OFF_COPY,
  GSC_RECS_NO_STORE_COPY,
  GSC_RECS_QUEUED_COPY,
  GSC_RECS_TURN_ON_CTA,
  GSC_SYNC_QUEUED_COPY,
  GSC_SYNC_RECS_OFF_COPY,
  gscRecTypeLabel,
} from '../src/lib/seo/gsc-copy';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultCapabilityFlags,
  gscApplyBlockedReason,
  isGscApplyWritable,
  isGscRecommendationsVisible,
  resolveWorkspaceCapabilities,
} from '@cerevex/contracts';

const flags = defaultCapabilityFlags();
assert.equal(flags['seo.gsc.recommendations'], 'hidden');
assert.equal(flags['seo.gsc.apply'], 'hidden');
assert.equal(isGscRecommendationsVisible(flags), false);
assert.equal(isGscApplyWritable(flags), false);
assert.equal(gscApplyBlockedReason(flags), 'capability_seo_gsc_apply');
assert.equal(
  gscApplyBlockedReason(resolveWorkspaceCapabilities({ capabilities: { 'seo.gsc.apply': 'recommend_only' } })),
  'capability_seo_gsc_apply_recommend_only',
);
assert.equal(
  isGscApplyWritable(resolveWorkspaceCapabilities({ capabilities: { 'seo.gsc.apply': 'on' } })),
  true,
);

assert.equal(parsePositionThreshold(undefined), GSC_DEFAULT_POSITION_THRESHOLD);
assert.equal(parsePositionThreshold('4.5'), 4.5);
assert.equal(parsePositionThreshold(0), 1);
assert.equal(parsePositionThreshold(99), 20);
assert.equal(gscApplyBlockedByKillSwitch({ config: {} }), true);
assert.equal(gscApplyBlockedByKillSwitch({ config: { gsc: { applyKillSwitch: false } } }), false);
assert.deepEqual(withGscStoreConfig({ gsc: { propertyUrl: 'sc-domain:hvacusa.store' } }, { positionThreshold: 4 }).gsc, {
  propertyUrl: 'sc-domain:hvacusa.store',
  positionThreshold: 4,
});

assert.ok(GSC_POSITION_EDUCATION.includes('position 5'));
assert.ok(GSC_RECS_FLAG_OFF_COPY.includes('Capability flags'));
assert.ok(GSC_RECS_FLAG_OFF_COPY.includes('does not turn the flag on'));
assert.ok(GSC_RECS_NO_STORE_COPY.includes('No store'));
assert.ok(GSC_RECS_QUEUED_COPY.includes('queued'));
assert.ok(GSC_SYNC_QUEUED_COPY.includes('queued'));
assert.ok(GSC_SYNC_RECS_OFF_COPY.includes('does not turn the flag on'));
assert.ok(GSC_SYNC_RECS_OFF_COPY.includes('Capability flags'));
assert.equal(GSC_RECS_TURN_ON_CTA, 'Turn on Search recommendations');

const here = dirname(fileURLToPath(import.meta.url));
const gscSyncSrc = readFileSync(join(here, '../../../jobs/seo/src/functions/gsc-sync.ts'), 'utf8');
assert.ok(gscSyncSrc.includes("from '@brain/lib/seo/gsc-flags'"), 'gsc-sync must static-import flag helpers');
assert.ok(!gscSyncSrc.includes("await import('@brain/lib/seo/gsc-flags')"), 'gsc-sync must not dynamically import flag helpers');
assert.ok(gscSyncSrc.includes('step.sendEvent'), 'gsc-sync must emit recommendations via step.sendEvent');
assert.ok(!gscSyncSrc.includes('inngest.send'), 'gsc-sync must not nest inngest.send inside step.run');
assert.ok(!/catch\s*\{\s*\}/.test(gscSyncSrc), 'gsc-sync must not swallow emit failures');
assert.ok(gscSyncSrc.includes('gsc.recommendations.skipped'), 'flag-off must log a skip reason');
assert.ok(gscSyncSrc.includes('gsc.recommendations.emit_failed'), 'emit failure must log a system event');

const findingsSrc = readFileSync(join(here, '../app/seo/findings/page.tsx'), 'utf8');
assert.ok(findingsSrc.includes("redirect('/seo/findings?recs=flag_off')"));
assert.ok(findingsSrc.includes("redirect('/seo/findings?recs=no_store')"));
assert.ok(!/if \(!gscRecommendationsCanGenerate\(store\)\) return;/.test(findingsSrc));

const searchSrc = readFileSync(join(here, '../app/seo/search/page.tsx'), 'utf8');
assert.ok(searchSrc.includes('sync=recs_off'));
assert.ok(searchSrc.includes(GSC_RECS_TURN_ON_CTA) || searchSrc.includes('GSC_RECS_TURN_ON_CTA'));
assert.ok(searchSrc.includes('SubmitButton'));
assert.ok(!/SERP|volatility|soft rank/i.test(GSC_POSITION_EDUCATION));
assert.equal(gscRecTypeLabel('gsc_u'), GSC_REC_TYPE_LABELS.gsc_u);
assert.equal(isGscRecKind('gsc_a'), true);
assert.equal(isGscRecKind('striking_distance'), false);
assert.equal(isGscSourcedJob({ source: 'gsc', gscRecType: 'gsc_u' }), true);
assert.equal(isGscSourcedJob({}), false);

assert.equal(normalizePageUrl('https://hvacusa.store/pages/ac-repair/'), '/pages/ac-repair');
assert.equal(queryClusterKey('AC repair near me'), queryClusterKey('near me ac repair'));
assert.ok(tokenOverlap(tokenize('ac repair dallas'), tokenize('ac repair in dallas')) > 0.5);
assert.equal(isWeakCtr(0.01, 200, 3), true);
assert.equal(isWeakCtr(0.2, 200, 1), false);

const mismatch = nameDiscrepancy(
  ['ac repair near me', 'emergency ac repair'],
  'how air conditioners work',
  'How air conditioners work. A history of cooling and what an AC unit is.',
);
assert.equal(mismatch.glaring, true);
assert.ok(mismatch.sentence && mismatch.sentence.includes('ac repair near me'));
assert.ok(mismatch.sentence && mismatch.sentence.includes('how air conditioners work'));

const aligned = nameDiscrepancy(
  ['ac repair dallas'],
  'AC repair in Dallas',
  'AC repair in Dallas. Book a same-day repair visit. Emergency air conditioning repair.',
);
assert.equal(aligned.glaring, false);
assert.equal(aligned.sentence, null);

const catalog = [
  {
    id: 'cat-repair',
    shopifyId: 'gid://shopify/Page/1',
    resourceType: 'page',
    handle: 'ac-tips',
    title: 'How air conditioners work',
    seoTitle: 'How air conditioners work',
    seoDescription: 'A guide to what an AC unit is.',
    bodyHtml: '<h1>How air conditioners work</h1><p>History of cooling and what an AC unit means.</p>',
  },
  {
    id: 'cat-money',
    shopifyId: 'gid://shopify/Collection/2',
    resourceType: 'collection',
    handle: 'mini-splits',
    title: 'Mini splits',
    seoTitle: 'Mini splits',
    seoDescription: 'Browse mini splits.',
    bodyHtml: '<h1>Mini splits</h1><p>Shop ductless mini split systems.</p>',
  },
  {
    id: 'cat-overlap-a',
    shopifyId: 'gid://shopify/Page/3',
    resourceType: 'page',
    handle: 'ac-repair',
    title: 'AC repair',
    seoTitle: 'AC repair',
    seoDescription: 'Book AC repair.',
    bodyHtml: '<h1>AC repair</h1><p>Book a repair visit today.</p>',
  },
  {
    id: 'cat-overlap-b',
    shopifyId: 'gid://shopify/Page/4',
    resourceType: 'page',
    handle: 'air-conditioner-repair',
    title: 'Air conditioner repair tips',
    seoTitle: 'Repair tips',
    seoDescription: 'Tips.',
    bodyHtml: '<h1>Tips</h1><p>DIY tips.</p>',
  },
];

const rows = [
  { query: 'ac repair near me', page: 'https://hvacusa.store/pages/ac-tips', impressions: 400, clicks: 4, ctr: 0.01, position: 6.2 },
  { query: 'emergency ac repair', page: 'https://hvacusa.store/pages/ac-tips', impressions: 120, clicks: 1, ctr: 0.008, position: 7.1 },
  { query: 'mini split install quote', page: 'https://hvacusa.store/collections/mini-splits', impressions: 300, clicks: 6, ctr: 0.02, position: 4.8 },
  { query: 'what is seer rating', page: 'https://hvacusa.store/blogs/news/seer', impressions: 80, clicks: 8, ctr: 0.1, position: 3.2 },
  { query: 'furnace replacement cost', page: null, impressions: 220, clicks: 0, ctr: 0, position: 0 },
  { query: 'ac repair dallas', page: 'https://hvacusa.store/pages/ac-repair', impressions: 180, clicks: 10, ctr: 0.055, position: 5.4 },
  { query: 'ac repair dallas', page: 'https://hvacusa.store/pages/air-conditioner-repair', impressions: 90, clicks: 2, ctr: 0.022, position: 8.1 },
];

const recs = generateGscRecommendations({ rows, catalog, positionThreshold: 3 });
const types = new Set(recs.map((rec) => rec.recType));
assert.ok(types.has('gsc_a'), 'realign should fire for glaring mismatch');
assert.ok(types.has('gsc_u'), 'update should fire for under-threshold money page');
assert.ok(types.has('gsc_n'), 'create should fire for orphan commercial query');
assert.ok(types.has('gsc_c'), 'combine should fire for overlapping pages');
assert.ok(recs.length <= 20);

const realign = recs.find((rec) => rec.recType === 'gsc_a');
assert.ok(realign?.discrepancy);
assert.ok(!/position 6/.test(realign?.why || ''));
assert.equal(recs.some((rec) => rec.recType === 'gsc_u' && rec.page?.includes('/pages/ac-tips')), false);

const update = recs.find((rec) => rec.recType === 'gsc_u');
assert.ok(update);
assert.ok(/convert/i.test(update.why));
assert.equal(update.discrepancy, null);
assert.ok(update.position > 3);

const create = recs.find((rec) => rec.recType === 'gsc_n');
assert.ok(create);
assert.ok(create.query?.includes('furnace replacement'));
assert.ok(create.offerIntent && /convert|quote|book|call/i.test(create.offerIntent));

const combine = recs.find((rec) => rec.recType === 'gsc_c');
assert.ok(combine && combine.pages.length >= 2);
assert.ok(combine.keeperUrl);

const vanityOnly = generateGscRecommendations({
  rows: [{ query: 'what is seer rating', page: 'https://hvacusa.store/blogs/news/seer', impressions: 80, clicks: 8, ctr: 0.1, position: 3.2 }],
  catalog: [],
  positionThreshold: 3,
});
assert.equal(vanityOnly.some((rec) => rec.recType === 'gsc_n' && rec.query === 'what is seer rating'), false);
assert.equal(vanityOnly.some((rec) => /write more/i.test(rec.why)), false);

const tightThreshold = generateGscRecommendations({ rows, catalog, positionThreshold: 8 });
assert.ok(!tightThreshold.some((rec) => rec.recType === 'gsc_u' && rec.position <= 8));
const looseThreshold = generateGscRecommendations({ rows, catalog, positionThreshold: 3 });
assert.ok(looseThreshold.some((rec) => rec.recType === 'gsc_u' || rec.recType === 'gsc_a'));

const commercial = recs.find((rec) => rec.recType === 'gsc_u' || rec.query === 'furnace replacement cost')!;
const vanity = generateGscRecommendations({
  rows: [{ query: 'history of air conditioning', page: 'https://hvacusa.store/blogs/news/history', impressions: 300, clicks: 20, ctr: 0.06, position: 6 }],
  catalog: [{ handle: 'history', resourceType: 'article', title: 'History of air conditioning', seoTitle: 'History of air conditioning', bodyHtml: '<h1>History of air conditioning</h1><p>A history of cooling.</p>' }],
  positionThreshold: 3,
});
if (vanity[0] && commercial) {
  assert.ok(commercial.score > vanity[0].score || vanity.length === 0);
}

assert.ok(!recs.some((rec) => /climb|vanity|SERP/i.test(rec.why)));
console.log('gsc-recommendations: ok');
