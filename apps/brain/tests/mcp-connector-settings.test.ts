import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONNECTOR_ENV_STATUS,
  CONNECTOR_OFF_STATUS,
  CONNECTOR_ON_STATUS,
  CONNECTOR_UNKNOWN_STATUS,
  connectorOnFromForm,
  connectorSwitchView,
  parseCreateForm,
  parseScopes,
} from '../lib/mcp-connector';

const here = dirname(fileURLToPath(import.meta.url));

assert.equal(parseScopes(['cerevex.read', 'cerevex.apply']), null);
assert.deepEqual(parseScopes(['cerevex.recs.submit']), ['cerevex.recs.submit']);
assert.equal(parseScopes([]), null);

const form = new FormData();
form.set('displayName', '  Grok_Bot  ');
form.append('scopes', 'cerevex.read');
const parsed = parseCreateForm(form);
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.deepEqual(parsed.body, { displayName: 'Grok_Bot', scopes: ['cerevex.read'], clientIds: [] });
  assert.equal('token' in parsed.body, false);
  assert.equal('name' in parsed.body, false);
}
form.set('displayName', 'Grok\nBot');
assert.equal(parseCreateForm(form).ok, false);
form.set('displayName', 'example-agent');
const slugNamed = parseCreateForm(form);
assert.equal(slugNamed.ok, true);

const off = new FormData();
assert.equal(connectorOnFromForm(off), false);
off.set('connectorOn', 'on');
assert.equal(connectorOnFromForm(off), true);
off.set('connectorOn', 'false');
assert.equal(connectorOnFromForm(off), false);

assert.deepEqual(connectorSwitchView({ killSwitch: null, envForcedOff: false }), {
  known: false,
  savedOff: true,
  envForcedOff: false,
  off: true,
  status: CONNECTOR_UNKNOWN_STATUS,
  canEdit: false,
});
assert.equal(connectorSwitchView({ killSwitch: true, envForcedOff: false }).status, CONNECTOR_OFF_STATUS);
assert.equal(connectorSwitchView({ killSwitch: true, envForcedOff: false }).canEdit, true);
assert.equal(connectorSwitchView({ killSwitch: false, envForcedOff: false }).off, false);
assert.equal(connectorSwitchView({ killSwitch: false, envForcedOff: false }).status, CONNECTOR_ON_STATUS);
const forced = connectorSwitchView({ killSwitch: false, envForcedOff: true });
assert.equal(forced.off, true);
assert.equal(forced.savedOff, false);
assert.equal(forced.canEdit, false);
assert.equal(forced.status, CONNECTOR_ENV_STATUS);
assert.equal(connectorSwitchView({ killSwitch: true, envForcedOff: true }).canEdit, false);
assert.equal(connectorSwitchView({ killSwitch: null, envForcedOff: true }).status, CONNECTOR_ENV_STATUS);

const settings = readFileSync(join(here, '../app/settings/page.tsx'), 'utf8');
const panel = readFileSync(join(here, '../components/connector-settings-panel.tsx'), 'utf8');
const formSrc = readFileSync(join(here, '../components/connector-settings.tsx'), 'utf8');
const actions = readFileSync(join(here, '../lib/mcp-connector-actions.ts'), 'utf8');
assert.ok(settings.includes('id="connector"'));
assert.ok(settings.includes('ConnectorSettingsPanel'));
assert.ok(panel.includes('asOwner: true'));
assert.ok(actions.includes('consoleAuthorized'));
assert.ok(actions.includes('asOwner: true'));
assert.ok(!actions.includes('ADS_INTERNAL_KEY'));
assert.ok(!actions.includes('redirect('));
assert.ok(!formSrc.includes('searchParams'));
assert.ok(formSrc.includes('Display name'));
assert.ok(formSrc.includes('name="displayName"'));
assert.ok(formSrc.includes('identity.displayName'));
assert.ok(panel.includes('parseMcpDisplayName'));
assert.ok(formSrc.includes('Token, shown once'));
assert.ok(formSrc.includes('Revoke'));
assert.ok(formSrc.includes('cx-switch'));
assert.ok(formSrc.includes('name="connectorOn"'));
assert.ok(formSrc.includes('role="switch"'));
assert.ok(formSrc.includes('connectorSwitchView'));
assert.ok(formSrc.includes('{connector.status}'));
assert.ok(panel.includes('envForcedOff'));
assert.ok(actions.includes('connectorOnFromForm'));
assert.ok(actions.includes('envForcedOff'));

console.log('mcp-connector-settings: ok');
