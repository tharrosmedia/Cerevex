import assert from 'node:assert/strict';
import { adsWorkspaceSettingsPatch, capabilityPatchShowsSaved } from '../src/lib/db/workspace-ads-sync';

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

console.log('workspace-sync: ok');
