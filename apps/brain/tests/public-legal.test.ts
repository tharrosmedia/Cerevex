import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_PAGES,
  isPublicLegalPath,
  publicLegalDecision,
} from '../lib/public-paths';

assert.deepEqual(
  LEGAL_PAGES.map((page) => page.href),
  ['/terms-of-service', '/privacy-policy', '/data-deletion'],
);
assert.equal(LEGAL_CONTACT_EMAIL, 'support@cerevex.store');

for (const page of LEGAL_PAGES) {
  assert.equal(isPublicLegalPath(page.href), true);
  assert.equal(publicLegalDecision(page.href).kind, 'public');
  assert.deepEqual(publicLegalDecision(`${page.href}/`), { kind: 'redirect', pathname: page.href });
  assert.deepEqual(publicLegalDecision(`${page.href}///`), { kind: 'redirect', pathname: page.href });
}

assert.equal(isPublicLegalPath('/login'), false);
assert.equal(isPublicLegalPath('/settings'), false);
assert.equal(isPublicLegalPath('/ads/audit-log'), false);
assert.equal(publicLegalDecision('/ads/audit-log').kind, 'auth');
assert.equal(publicLegalDecision('/').kind, 'auth');
assert.equal(publicLegalDecision('/terms-of-service/extra').kind, 'auth');

const here = dirname(fileURLToPath(import.meta.url));
const middleware = readFileSync(join(here, '../middleware.ts'), 'utf8');
assert.ok(middleware.includes('publicLegalDecision'));
assert.ok(middleware.includes('301'));

const privacy = readFileSync(join(here, '../app/privacy-policy/page.tsx'), 'utf8');
const deletion = readFileSync(join(here, '../app/data-deletion/page.tsx'), 'utf8');
const terms = readFileSync(join(here, '../app/terms-of-service/page.tsx'), 'utf8');
const shell = readFileSync(join(here, '../components/legal-document.tsx'), 'utf8');
const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
const layout = readFileSync(join(here, '../app/layout.tsx'), 'utf8');
const flat = (src: string) => src.replace(/\s+/g, ' ');

assert.ok(shell.includes('DRAFT'));
assert.ok(shell.includes('counsel'));
assert.ok(shell.includes('Tharros Media'));
assert.ok(shell.includes('LEGAL_CONTACT_EMAIL'));

for (const src of [privacy, deletion, terms]) {
  assert.ok(src.includes('LegalDocument'));
  assert.ok(src.includes('Tharros Media'));
  assert.ok(src.includes('LEGAL_CONTACT_EMAIL'));
}

const privacyText = flat(privacy);
const deletionText = flat(deletion);
assert.ok(privacyText.includes('Meta'));
assert.ok(privacyText.includes('Google'));
assert.ok(privacyText.includes('/data-deletion'));
assert.ok(privacyText.includes('We do not sell personal data'));

assert.ok(deletionText.includes('Settings'));
assert.ok(deletionText.includes('Connects'));
assert.ok(deletionText.includes('Connect Meta'));
assert.ok(deletionText.includes('Connect Google Ads'));
assert.ok(deletionText.includes('7 business days'));
assert.ok(deletionText.includes('30 days'));
assert.ok(deletionText.includes('does not erase'));
assert.ok(!/LLP|Esq\.|law firm/i.test(flat(deletion + privacy + terms)));

assert.ok(login.includes('LegalLinks'));
assert.ok(layout.includes('isPublicLegalPath'));
assert.ok(layout.includes('LegalLinks'));

console.log('public-legal: ok');
