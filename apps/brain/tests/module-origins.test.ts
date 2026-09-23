import assert from 'node:assert/strict';
import { defaultCapabilityFlags } from '@shopify-brain/contracts';
import { adsModuleHref, adsModuleOrigin } from '../lib/module-origins';

const prevChrome = process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME;
const prevOrigin = process.env.NEXT_PUBLIC_ADS_ORIGIN;

process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME = '1';
process.env.NEXT_PUBLIC_ADS_ORIGIN = 'https://ads-web.example';

const hidden = defaultCapabilityFlags();
assert.equal(adsModuleOrigin(hidden), '');
assert.equal(adsModuleHref('/app/clients', hidden), '/ads');

const allowed = { ...hidden, 'shell.legacy_ads_web': 'on' as const };
assert.equal(adsModuleOrigin(allowed), 'https://ads-web.example');
assert.equal(adsModuleHref('app/clients', allowed), 'https://ads-web.example/app/clients');

process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME = '0';
assert.equal(adsModuleOrigin(allowed), '');

if (prevChrome === undefined) delete process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME;
else process.env.NEXT_PUBLIC_ADS_LEGACY_CHROME = prevChrome;
if (prevOrigin === undefined) delete process.env.NEXT_PUBLIC_ADS_ORIGIN;
else process.env.NEXT_PUBLIC_ADS_ORIGIN = prevOrigin;

console.log('module-origins: ok');
