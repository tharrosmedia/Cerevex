import assert from 'node:assert/strict';
import { adsCallerHeaders, adsWorkspaceSettingsPatch, capabilityPatchShowsSaved } from '../src/lib/db/workspace-ads-sync';

assert.deepEqual(adsWorkspaceSettingsPatch({ businessType: 'agency' }), { businessType: 'agency' });
assert.deepEqual(adsWorkspaceSettingsPatch({ modules: { clients: true, sales: false } }), {
  modules: { clients: true, sales: false },
});
assert.deepEqual(adsWorkspaceSettingsPatch({ capabilities: { apply: 'recommend_only' } }), {
  capabilities: { apply: 'recommend_only' },
});
assert.equal(adsWorkspaceSettingsPatch({}), null);
assert.equal(adsWorkspaceSettingsPatch({ modules: {} }), null);
assert.equal(adsWorkspaceSettingsPatch({ capabilities: {} }), null);
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 403, reason: 'unauthorized' }), false);
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 401, reason: 'unauthorized' }), false);
assert.equal(capabilityPatchShowsSaved({ ok: true, status: 200 }), true);
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 503, reason: 'error' }), true);

const safetyOn = { 'site.wordpress.apply': 'on', 'seo.gsc.apply': 'on' };
for (const status of [400, 401, 403, 404, 409, 500, 503]) {
  assert.equal(
    capabilityPatchShowsSaved({ ok: false, status, reason: status === 503 ? 'unreachable' : 'error' }, safetyOn),
    false,
    `safety on must fail closed at ${status}`,
  );
}
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 503, reason: 'not_configured' }, safetyOn), false);
assert.equal(capabilityPatchShowsSaved({ ok: true, status: 200 }, safetyOn), true);
assert.equal(
  capabilityPatchShowsSaved({ ok: false, status: 503, reason: 'error' }, { apply: 'recommend_only' }),
  true,
);

const ownerHeaders = adsCallerHeaders({ safetyOn: true, internalKey: 'svc', ownerToken: 'owner-jwt' });
assert.equal(ownerHeaders.get('x-cerevex-internal-key'), null);
assert.equal(ownerHeaders.get('authorization'), 'Bearer owner-jwt');
const closedHeaders = adsCallerHeaders({ safetyOn: true, internalKey: 'svc', ownerToken: '  ' });
assert.equal(closedHeaders.get('authorization'), null);
assert.equal(closedHeaders.get('x-cerevex-internal-key'), null);
const serviceHeaders = adsCallerHeaders({ safetyOn: false, internalKey: 'svc', ownerToken: 'tok' });
assert.equal(serviceHeaders.get('x-cerevex-internal-key'), 'svc');
assert.equal(serviceHeaders.get('authorization'), 'Bearer tok');

console.log('workspace-sync: ok');
