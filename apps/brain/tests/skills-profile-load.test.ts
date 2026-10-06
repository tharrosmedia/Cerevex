import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientForSite, runSkillsProfileLoad, skillsProfilePost } from '../lib/skills-profile-load';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env as Record<string, string | undefined>;
const prevPassword = env.APP_PASSWORD;
const prevConsole = env.CONSOLE_OPERATOR_EMAIL;
const prevApprovers = env.APPROVE_OPERATOR_EMAILS;
const prevNode = env.NODE_ENV;

function restore() {
  if (prevPassword === undefined) delete env.APP_PASSWORD;
  else env.APP_PASSWORD = prevPassword;
  if (prevConsole === undefined) delete env.CONSOLE_OPERATOR_EMAIL;
  else env.CONSOLE_OPERATOR_EMAIL = prevConsole;
  if (prevApprovers === undefined) delete env.APPROVE_OPERATOR_EMAILS;
  else env.APPROVE_OPERATOR_EMAILS = prevApprovers;
  if (prevNode === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = prevNode;
}

try {
  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  delete env.APPROVE_OPERATOR_EMAILS;
  delete env.CONSOLE_OPERATOR_EMAIL;

  const site = 'store-1';
  assert.deepEqual(clientForSite([{ id: 'c1', siteId: site }], site), { ok: true, clientId: 'c1' });
  assert.equal(clientForSite([{ id: 'c1', siteId: null }], site).ok, false);
  assert.equal(clientForSite([{ id: 'c1', siteId: site }, { id: 'c2', siteId: site }], site).ok, false);

  const post = skillsProfilePost('c1', 'hvac-usa');
  assert.equal(post.path, '/clients/c1/skills-profile');
  assert.equal(post.method, 'POST');
  assert.deepEqual(post.body, { slug: 'hvac-usa' });
  assert.equal(post.asOwner, true);

  let calls = 0;
  const refused = await runSkillsProfileLoad({
    creds: { cookie: 'console-secret', internalKey: null },
    siteId: site,
    slug: 'hvac-usa',
    load: async () => {
      calls += 1;
      return { ok: true, snapshotId: 'snap', clientId: 'c1' };
    },
  });
  env.CONSOLE_OPERATOR_EMAIL = 'operator@example.com';
  const operator = await runSkillsProfileLoad({
    creds: { cookie: 'console-secret', internalKey: 'internal-secret' },
    siteId: site,
    slug: 'hvac-usa',
    load: async () => {
      calls += 1;
      return { ok: true, snapshotId: 'snap', clientId: 'c1' };
    },
  });
  assert.equal(operator.ok, false);
  if (!operator.ok) assert.equal(operator.status, 403);
  assert.equal(calls, 1);
  assert.equal(refused.ok, true);

  const anon = await runSkillsProfileLoad({
    creds: { cookie: null, internalKey: 'internal-secret' },
    siteId: site,
    slug: 'hvac-usa',
    load: async () => {
      calls += 1;
      return { ok: true, snapshotId: 'snap', clientId: 'c1' };
    },
  });
  assert.equal(anon.ok, false);
  if (!anon.ok) assert.equal(anon.status, 401);
  assert.equal(calls, 1);

  const page = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
  const action = readFileSync(join(here, '../lib/skills-profile-action.ts'), 'utf8');
  assert.match(page, /Load skills profile/);
  assert.match(page, /loadSkillsProfileAction/);
  assert.match(page, /authorizeApproveSession/);
  assert.match(action, /authorizeApproveSession/);
  assert.match(action, /runSkillsProfileLoad/);

  console.log('skills-profile-load: ok');
} finally {
  restore();
}
