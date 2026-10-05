import assert from 'node:assert/strict';
import {
  adsCallerHeaders,
  adsWorkspaceSettingsPatch,
  capabilityPatchShowsSaved,
  ownerCapabilitySaveConfirmed,
} from '../src/lib/db/workspace-ads-sync';
import { stripEditableApplyGates } from '../src/lib/ads-confirmed-safety';

assert.deepEqual(adsWorkspaceSettingsPatch({ businessType: 'agency' }), { businessType: 'agency' });
assert.deepEqual(adsWorkspaceSettingsPatch({ modules: { clients: true, sales: false } }), {
  modules: { clients: true, sales: false },
});
assert.deepEqual(adsWorkspaceSettingsPatch({ capabilities: { apply: 'recommend_only' } }), {
  capabilities: { apply: 'recommend_only' },
});
assert.equal(adsWorkspaceSettingsPatch({ capabilities: { apply: 'on' } }), null);
assert.deepEqual(
  adsWorkspaceSettingsPatch({ capabilities: { apply: 'on', 'connect.meta': 'on' } }),
  { capabilities: { 'connect.meta': 'on' } },
);
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
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 401, reason: 'unauthorized' }, { 'site.wordpress.apply': 'hidden' }), true);
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 403, reason: 'unauthorized' }, { 'seo.gsc.apply': 'recommend_only' }), true);
assert.equal(capabilityPatchShowsSaved({ ok: false, status: 401, reason: 'unauthorized' }, { apply: 'hidden' }), true);

const workspaceId = '00000000-0000-4000-8000-000000000001';
const ownerUserId = '00000000-0000-4000-8000-000000000002';
const confirmed = {
  ok: true,
  data: {
    workspace: { id: workspaceId, capabilities: { 'site.wordpress.apply': 'on', 'seo.gsc.apply': 'on' } },
    ownerUserId,
  },
};
assert.equal(
  ownerCapabilitySaveConfirmed({ result: confirmed, workspaceId, ownerUserId, capabilityIds: ['site.wordpress.apply'] }),
  true,
);
assert.equal(
  ownerCapabilitySaveConfirmed({
    result: confirmed,
    workspaceId: '00000000-0000-4000-8000-000000000099',
    ownerUserId,
    capabilityIds: ['site.wordpress.apply'],
  }),
  false,
);
assert.equal(
  ownerCapabilitySaveConfirmed({
    result: { ok: true, data: '<html>ok</html>' },
    workspaceId,
    ownerUserId,
    capabilityIds: ['site.wordpress.apply'],
  }),
  false,
);
assert.equal(
  ownerCapabilitySaveConfirmed({
    result: { ok: true, data: { workspace: { id: workspaceId, capabilities: { 'site.wordpress.apply': 'hidden' } }, ownerUserId } },
    workspaceId,
    ownerUserId,
    capabilityIds: ['site.wordpress.apply'],
  }),
  false,
);
assert.equal(
  ownerCapabilitySaveConfirmed({
    result: { ok: true, data: { workspace: { id: workspaceId, capabilities: { 'site.wordpress.apply': 'on' } }, ownerUserId: null } },
    workspaceId,
    ownerUserId,
    capabilityIds: ['site.wordpress.apply'],
  }),
  false,
);
assert.deepEqual(
  stripEditableApplyGates({
    workspace: {
      capabilities: { 'site.wordpress.apply': 'on', 'site.wordpress.connect': 'on', 'seo.gsc.apply': 'on' },
      adsConfirmedSafety: ['site.wordpress.apply'],
    },
  }),
  { workspace: { capabilities: { 'site.wordpress.connect': 'on' } } },
);
assert.deepEqual(
  stripEditableApplyGates({
    workspace: {
      capabilities: {
        'site.wordpress.apply': 'hidden',
        'seo.gsc.apply': 'recommend_only',
        'site.wordpress.connect': 'on',
      },
    },
  }),
  {
    workspace: {
      capabilities: {
        'site.wordpress.apply': 'hidden',
        'seo.gsc.apply': 'recommend_only',
        'site.wordpress.connect': 'on',
      },
    },
  },
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
