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
assert.equal(suggestionLabel('budget_shift'), 'Shift the budget');
assert.equal(suggestionWhy('create_alternative').toLowerCase().includes('approve'), true);
assert.equal(suggestionLabel('call_attribution'), 'Calls joined to a campaign');
assert.equal(suggestionWhy('crm_booked_job'), 'A call matches a booked job. Nothing was written to the CRM.');
assert.equal(suggestionLabel('lead_lifecycle'), 'Lead moved toward booked');
assert.ok(suggestionWhy('lead_lifecycle').toLowerCase().includes('crm apply later'));
assert.equal(suggestionLabel('booked_job'), 'Booked jobs can steer ads');
assert.equal(suggestionLabel('lp_intelligence'), 'Improve the landing page');
assert.ok(suggestionWhy('lp_intelligence').toLowerCase().includes('site apply later'));
assert.equal(suggestionLabel('creative_fatigue'), 'Refresh the tired ad');
assert.ok(!suggestionWhy('creative_fatigue').toLowerCase().includes('ctr'));
assert.equal(suggestionLabel('search_negatives'), 'Add Google negatives');
assert.ok(suggestionWhy('search_negatives').toLowerCase().includes('approve'));
assert.equal(suggestionLabel('geo_discipline'), 'Tighten the service area');
assert.equal(suggestionLabel('brand_guardrails'), 'Hold a claim or brand risk');
assert.ok(suggestionWhy('brand_guardrails').toLowerCase().includes('block'));
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
assert.equal(isAllowedAdsProxyRequest('GET', `/clients/${recId}/creatives`), true);
assert.equal(isAllowedAdsProxyRequest('GET', '/funnel'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/brainstorm/generate'), false);
assert.equal(isAllowedAdsProxyRequest('GET', `/clients/${recId}/offline-attribution`), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/callrail/connect'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/callrail/pull'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/bundled/connect'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/bundled/pull'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/crm/connect'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/crm/pull'), true);
assert.equal(isAllowedAdsProxyRequest('GET', `/clients/${recId}/lead-lifecycle`), true);
assert.equal(isAllowedAdsProxyRequest('GET', `/clients/${recId}/lp-intelligence`), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/clarity/connect'), true);
assert.equal(isAllowedAdsProxyRequest('POST', '/connectors/clarity/pull'), true);

console.log('ads-copy: ok');
