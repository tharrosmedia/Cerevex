import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSkillProfileSlug } from '../lib/skills-profile-slugs';

const here = dirname(fileURLToPath(import.meta.url));

assert.equal(defaultSkillProfileSlug('Elmar HVAC'), 'elmar-hvac');
assert.equal(defaultSkillProfileSlug('Got Ductless'), 'got-ductless');
assert.equal(defaultSkillProfileSlug('KC Prestige'), 'kc-prestige-hvac');
assert.equal(defaultSkillProfileSlug('HVAC USA'), 'hvac-usa');
assert.equal(defaultSkillProfileSlug('Unknown Store'), '');

const page = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
assert.equal(page.includes('defaultValue="hvac-usa"'), false);
assert.match(page, /defaultValue=\{defaultSkillProfileSlug\(store\.name\)\}/);
assert.match(page, /<option value="" disabled>Choose a profile…<\/option>/);

console.log('skills-profile-slugs: ok');
