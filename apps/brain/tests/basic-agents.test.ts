import assert from 'assert';
import { evaluate } from '../src/lib/agents/core/evaluate.js';
import { createBrief } from '../src/lib/agents/seo/brief.js';
import { selectProductsForCollection } from '../src/lib/agents/seo/select-products.js';
import { functions } from '@shopify-brain/jobs-seo';

// Basic smoke tests for upgraded agents (no real LLM calls in fallback paths)

async function run() {
  console.log('Running light agent tests...');

  // evaluate fallback path
  const evalRes = await evaluate({ bodyHtml: '<p>test faq content</p>' }, 'collection');
  assert.ok(evalRes.length > 0);
  assert.ok(typeof evalRes.score === 'number');
  assert.ok(evalRes.type === 'collection');
  console.log('evaluate: ok');

  // brief fallback
  const brief = await createBrief({ storeId: 'test', keyword: 'test', research: { summary: 'facts' }, type: 'page' });
  assert.ok((brief.sectionOutline && brief.sectionOutline.length > 0) || brief.intent);
  assert.ok(brief.keyword === 'test');
  console.log('brief: ok');

  // select products (P0)
  const cands = [{ shopifyId: 'gid://shopify/Product/1', title: 'Red Widget', handle: 'red-widget' }, { shopifyId: 'gid://shopify/Product/2', title: 'Blue Thing', handle: 'blue-thing' }];
  const sel = selectProductsForCollection({ storeId: 't', keyword: 'widget', candidateProducts: cands });
  assert.ok(sel.selected.length >= 1);
  assert.ok(sel.selected[0].shopifyId.includes('1'));
  console.log('select-products: ok');

  // jobs/seo still registered with original seo-* IDs (Plan 1.5 — do not rename)
  const ids = functions.map((fn: { id: () => string }) => fn.id());
  for (const id of [
    'seo-job',
    'seo-research',
    'seo-create-brief',
    'seo-write-draft',
    'seo-publish',
    'seo-audit',
  ]) {
    assert.ok(ids.includes(id), `missing Inngest function id ${id}`);
  }
  assert.ok(ids.every((id: string) => !id.startsWith('brain-')), 'seo function IDs must not be renamed to brain-*');
  console.log('jobs/seo ids: ok', ids.length);

  console.log('All light tests passed.');
}

run().catch(e => { console.error(e); process.exit(1); });
