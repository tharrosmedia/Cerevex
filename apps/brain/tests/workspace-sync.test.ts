import assert from 'node:assert/strict';
import { adsWorkspaceSettingsPatch } from '../src/lib/db/workspace-ads-sync';

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

console.log('workspace-sync: ok');
