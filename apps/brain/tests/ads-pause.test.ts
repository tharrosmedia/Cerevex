import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postPause } from '../app/api/ads/pause/route';
import { guardApi } from '../lib/api-access';
import {
  ADS_PAUSE_CONFIRM_CHECK,
  ADS_PAUSE_CONFIRM_COPY,
  ADS_PAUSE_OFF_STATUS,
  ADS_PAUSE_ON_STATUS,
  pauseReturnWithNotice,
  pauseToggleView,
  safePauseReturn,
} from '../lib/ads-pause';

const env = process.env as Record<string, string | undefined>;
const prev = {
  APP_PASSWORD: env.APP_PASSWORD,
  ADS_INTERNAL_KEY: env.ADS_INTERNAL_KEY,
  ADS_INTERNAL_WORKSPACE_ID: env.ADS_INTERNAL_WORKSPACE_ID,
  ADS_API_TOKEN: env.ADS_API_TOKEN,
  APPROVE_OPERATOR_EMAILS: env.APPROVE_OPERATOR_EMAILS,
  CONSOLE_OPERATOR_EMAIL: env.CONSOLE_OPERATOR_EMAIL,
  NODE_ENV: env.NODE_ENV,
};

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function restore() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

function request(body: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/ads/pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type WriteCall = { workspaceId: string; applyKillSwitch: boolean; asOwner: boolean };

function harness(current: boolean) {
  const writes: WriteCall[] = [];
  return {
    writes,
    read: async (workspaceId: string) => {
      assert.equal(workspaceId, WORKSPACE);
      return { ok: true as const, applyKillSwitch: current };
    },
    write: async (input: WriteCall) => {
      writes.push(input);
      return { ok: true as const, applyKillSwitch: input.applyKillSwitch };
    },
  };
}

try {
  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  env.ADS_INTERNAL_KEY = 'internal-secret';
  env.ADS_INTERNAL_WORKSPACE_ID = WORKSPACE;
  env.ADS_API_TOKEN = 'owner-jwt';
  delete env.APPROVE_OPERATOR_EMAILS;
  delete env.CONSOLE_OPERATOR_EMAIL;

  const anon = guardApi('/api/ads/pause', 'POST', { cookie: null, internalKey: null });
  assert.equal(anon.kind, 'deny');
  const sessionGate = guardApi('/api/ads/pause', 'POST', { cookie: 'console-secret', internalKey: null });
  assert.equal(sessionGate.kind, 'allow');
  const internalGate = guardApi('/api/ads/pause', 'POST', { cookie: null, internalKey: 'internal-secret' });
  assert.equal(internalGate.kind, 'allow');

  const unauth = await postPause(request({ applyKillSwitch: false, confirm: true }), harness(true));
  assert.equal(unauth.status, 401);

  env.CONSOLE_OPERATOR_EMAIL = 'other@example.com';
  const nonOwner = harness(true);
  const nonOwnerRes = await postPause(
    request({ applyKillSwitch: false, confirm: true }, { cookie: 'auth=console-secret' }),
    nonOwner,
  );
  assert.equal(nonOwnerRes.status, 403);
  assert.equal(nonOwner.writes.length, 0);
  const nonOwnerPause = harness(false);
  const nonOwnerPauseRes = await postPause(
    request({ applyKillSwitch: true }, { cookie: 'auth=console-secret' }),
    nonOwnerPause,
  );
  assert.equal(nonOwnerPauseRes.status, 200);
  assert.equal(nonOwnerPause.writes.length, 1);
  assert.equal(nonOwnerPause.writes[0]?.applyKillSwitch, true);

  delete env.CONSOLE_OPERATOR_EMAIL;
  const missingConfirm = harness(true);
  const missingConfirmRes = await postPause(
    request({ applyKillSwitch: false }, { cookie: 'auth=console-secret' }),
    missingConfirm,
  );
  assert.equal(missingConfirmRes.status, 400);
  assert.match(String((await missingConfirmRes.json()).error), /Confirm/);
  assert.equal(missingConfirm.writes.length, 0);

  const owner = harness(true);
  const ownerRes = await postPause(
    request({ applyKillSwitch: false, confirm: true }, { cookie: 'auth=console-secret' }),
    owner,
  );
  assert.equal(ownerRes.status, 200);
  assert.deepEqual(owner.writes, [{ workspaceId: WORKSPACE, applyKillSwitch: false, asOwner: true }]);

  const serviceOff = harness(true);
  const serviceOffRes = await postPause(
    request({ applyKillSwitch: false, confirm: true }, { 'x-cerevex-internal-key': 'internal-secret' }),
    serviceOff,
  );
  assert.equal(serviceOffRes.status, 403);
  assert.match(String((await serviceOffRes.json()).error), /service key/i);
  assert.equal(serviceOff.writes.length, 0);

  const serviceOn = harness(false);
  const serviceOnRes = await postPause(
    request({ applyKillSwitch: true }, { 'x-cerevex-internal-key': 'internal-secret' }),
    serviceOn,
  );
  assert.equal(serviceOnRes.status, 200);
  assert.deepEqual(serviceOn.writes, [{ workspaceId: WORKSPACE, applyKillSwitch: true, asOwner: false }]);

  const cross = harness(true);
  const crossRes = await postPause(
    request({ applyKillSwitch: false, confirm: true, workspaceId: OTHER }, { cookie: 'auth=console-secret' }),
    cross,
  );
  assert.equal(crossRes.status, 403);
  assert.equal(cross.writes.length, 0);

  const same = harness(true);
  const sameRes = await postPause(
    request({ applyKillSwitch: true }, { cookie: 'auth=console-secret' }),
    same,
  );
  assert.equal(sameRes.status, 200);
  assert.equal((await sameRes.json()).unchanged, true);
  assert.equal(same.writes.length, 0);

  const paused = pauseToggleView({ killSwitchOn: true, owner: true });
  const running = pauseToggleView({ killSwitchOn: false, owner: false });
  assert.equal(paused.paused, true);
  assert.equal(paused.status, ADS_PAUSE_ON_STATUS);
  assert.equal(paused.showUnpause, true);
  assert.equal(paused.showPause, false);
  assert.equal(running.paused, false);
  assert.equal(running.status, ADS_PAUSE_OFF_STATUS);
  assert.equal(running.showPause, true);
  assert.equal(running.showUnpause, false);
  assert.equal(pauseToggleView({ killSwitchOn: null, owner: true }).showUnpause, false);

  assert.equal(safePauseReturn('https://ads-web.example/app/settings'), '/settings#ads-pause');
  assert.equal(pauseReturnWithNotice('/ads', 'pause=saved'), '/ads?pause=saved');
  assert.equal(pauseReturnWithNotice('/settings#ads-pause', 'pause=saved'), '/settings?pause=saved#ads-pause');

  const here = dirname(fileURLToPath(import.meta.url));
  const brainRoot = join(here, '..');
  const hits: string[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name === 'tests') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      if (text.includes('Turn on in Ads') || text.includes('adsSafetySettingsHref')) hits.push(full);
    }
  }
  for (const dir of ['app', 'components', 'lib', 'src']) walk(join(brainRoot, dir));
  assert.deepEqual(hits, []);

  const toggleSrc = readFileSync(join(brainRoot, 'components/ads/pause-toggle.tsx'), 'utf8');
  const settingsSrc = readFileSync(join(brainRoot, 'app/settings/page.tsx'), 'utf8');
  const cockpitSrc = readFileSync(join(brainRoot, 'app/ads/page.tsx'), 'utf8');
  const suggestionSrc = readFileSync(join(brainRoot, 'app/ads/suggestions/[id]/page.tsx'), 'utf8');
  const originsSrc = readFileSync(join(brainRoot, 'lib/module-origins.ts'), 'utf8');
  assert.ok(toggleSrc.includes('pauseToggleView'));
  assert.ok(toggleSrc.includes('ADS_PAUSE_CONFIRM_COPY'));
  assert.ok(toggleSrc.includes('ADS_PAUSE_CONFIRM_CHECK'));
  assert.ok(toggleSrc.includes('ADS_PAUSE_ACTION'));
  assert.ok(toggleSrc.includes('ADS_UNPAUSE_ACTION'));
  assert.ok(toggleSrc.includes('data-pause-state'));
  assert.ok(toggleSrc.includes("data-pause={view.known ? (view.paused ? 'on' : 'off') : 'unknown'}"));
  assert.ok(settingsSrc.includes('AdsPauseToggle'));
  assert.ok(cockpitSrc.includes('AdsPauseToggle'));
  assert.ok(suggestionSrc.includes('AdsPauseToggle'));
  assert.ok(!originsSrc.includes('NEXT_PUBLIC_ADS_ORIGIN}/app/settings') && !originsSrc.includes('/app/settings'));
  assert.ok(!toggleSrc.includes('NEXT_PUBLIC_ADS_ORIGIN'));

  console.log('ads-pause: ok');
} finally {
  restore();
}
