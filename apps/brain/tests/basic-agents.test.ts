import assert from 'assert';
import { evaluate } from '../src/lib/agents/core/evaluate.js';
import { createBrief } from '../src/lib/agents/seo/brief.js';
import { selectProductsForCollection } from '../src/lib/agents/seo/select-products.js';

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

  console.log('All light tests passed.');
}

run().catch(e => { console.error(e); process.exit(1); });
