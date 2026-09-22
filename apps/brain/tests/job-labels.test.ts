import assert from 'node:assert/strict';
import { jobInputDetails, jobInputLabel, jobStatusLabel, jobTypeLabel } from '../lib/job-labels';

assert.equal(jobTypeLabel('seo.generate'), 'SEO create');
assert.equal(jobStatusLabel('awaiting_approval'), 'Needs review');
assert.equal(jobStatusLabel('completed'), 'Done');

assert.equal(
  jobInputLabel({ keyword: 'Blog post draft', platform: 'shopify', mode: 'create' }, 'seo.create'),
  'SEO create — Blog post draft',
);
assert.equal(jobInputLabel({ title: 'About us' }), 'SEO — About us');
assert.equal(jobInputLabel({}), 'No details');
assert.equal(jobInputLabel(null), 'No details');
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('{'));
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('"'));
assert.deepEqual(jobInputDetails({ keyword: 'hvac repair', platform: 'shopify' }), [
  'Keyword: hvac repair',
  'Platform: shopify',
]);

console.log('job-labels: ok');
