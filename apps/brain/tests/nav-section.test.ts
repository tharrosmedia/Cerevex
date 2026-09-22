import assert from 'node:assert/strict';
import { navSectionFromPath, railItemsForSection } from '../lib/nav-section';

const seoItems = [
  { href: '/seo', label: 'Overview' },
  { href: '/seo/create', label: 'New content', rail: 'New' },
  { href: '/seo/live', label: 'Live catalog', rail: 'Catalog' },
  { href: '/seo/search', label: 'Search Console', rail: 'GSC' },
];

const adsItems = [
  { href: '/ads', label: 'Overview' },
  { href: '/ads/audits', label: 'Audits', rail: 'Audits' },
  { href: '/ads/suggestions', label: 'Suggestions', rail: 'Suggestions' },
  { href: '/ads/clients', label: 'Clients', rail: 'Clients' },
  { href: '/ads/leads', label: 'Leads', rail: 'Leads' },
  { href: '/ads/workflows', label: 'Workflows', rail: 'Workflows' },
];

function rails(pathname: string | null) {
  return railItemsForSection(navSectionFromPath(pathname), seoItems, adsItems).map((item) => item.rail);
}

assert.equal(navSectionFromPath('/seo'), 'seo');
assert.equal(navSectionFromPath('/seo/create'), 'seo');
assert.equal(navSectionFromPath('/ads'), 'ads');
assert.equal(navSectionFromPath('/ads/anything'), 'ads');
assert.equal(navSectionFromPath('/review'), null);
assert.equal(navSectionFromPath('/settings'), null);
assert.equal(navSectionFromPath('/'), null);

assert.deepEqual(rails('/seo'), ['New', 'Catalog', 'GSC']);
assert.deepEqual(rails('/seo/live'), ['New', 'Catalog', 'GSC']);
assert.deepEqual(rails('/ads'), ['Audits', 'Suggestions', 'Clients', 'Leads', 'Workflows']);
assert.deepEqual(rails('/review'), []);
assert.deepEqual(rails('/'), []);
assert.ok(!rails('/seo').includes('Clients'));
assert.ok(!rails('/seo').includes('Leads'));
assert.ok(!rails('/seo').includes('Workflows'));
assert.ok(!rails('/ads').includes('New'));

console.log('nav-section: ok');
