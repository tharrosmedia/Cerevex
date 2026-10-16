import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectorOffFromForm, parseCreateForm, parseScopes } from '../lib/mcp-connector';

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
assert.equal(connectorOffFromForm(off), false);
off.set('connectorOff', 'on');
assert.equal(connectorOffFromForm(off), true);

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

console.log('mcp-connector-settings: ok');
