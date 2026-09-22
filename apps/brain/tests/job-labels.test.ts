import assert from 'node:assert/strict';
import { jobInputLabel, jobStatusLabel, jobTypeLabel } from '../lib/job-labels';

assert.equal(jobTypeLabel('seo.generate'), 'New SEO page');
assert.equal(jobStatusLabel('awaiting_approval'), 'Needs review');
assert.equal(jobStatusLabel('completed'), 'Done');

assert.equal(
  jobInputLabel({ keyword: 'ductless mini split', platform: 'shopify', mode: 'refresh' }),
  'ductless mini split · Shopify · Refresh',
);
assert.equal(jobInputLabel({ title: 'About us' }), 'About us');
assert.equal(jobInputLabel({}), 'No details');
assert.equal(jobInputLabel(null), 'No details');
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('{'));
assert.ok(!jobInputLabel({ keyword: 'hvac repair' }).includes('"'));

console.log('job-labels: ok');
