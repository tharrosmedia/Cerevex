import assert from 'node:assert/strict';
import {
  findingLabel,
  rankSuggestions,
  riskLabel,
  suggestionLabel,
  suggestionWhy,
  auditStatusLabel,
} from '../lib/ads-copy';
import { isAllowedAdsProxyRequest } from '../lib/ads-proxy-allowlist';

assert.equal(findingLabel('low_ctr'), 'Ads not getting clicks');
assert.equal(findingLabel('zero_conversion_spend'), 'Spend with no leads');
assert.equal(suggestionLabel('pause_waste'), 'Stop wasted spend');
assert.equal(suggestionWhy('improve_ctr'), 'People are seeing the ad but not clicking it.');
assert.ok(!suggestionWhy('improve_ctr').toLowerCase().includes('ctr'));
assert.ok(!suggestionWhy('review_cpa').toLowerCase().includes('roas'));
assert.equal(riskLabel('high'), 'High risk');
assert.equal(auditStatusLabel('completed'), 'Done');
assert.equal(auditStatusLabel('queued'), 'Queued');

const ranked = rankSuggestions([
  { estimatedImpactUsd: '10', confidence: '1' },
  { estimatedImpactUsd: '80', confidence: '0.5' },
]);
assert.equal(ranked[0].estimatedImpactUsd, '80');

const recId = '11111111-1111-1111-1111-111111111111';
assert.equal(isAllowedAdsProxyRequest('GET', `/audits/${recId}`), true);
assert.equal(isAllowedAdsProxyRequest('POST', `/clients/${recId}/audits`), true);
assert.equal(isAllowedAdsProxyRequest('POST', `/recommendations/${recId}/decide`), false);
assert.equal(isAllowedAdsProxyRequest('POST', `/recommendations/${recId}/apply`), false);
assert.equal(isAllowedAdsProxyRequest('POST', '/oauth/mock/connect'), false);
assert.equal(isAllowedAdsProxyRequest('GET', '/clients'), true);

console.log('ads-copy: ok');
