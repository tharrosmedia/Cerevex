import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postPause } from '../app/api/ads/pause/route';
import { guardApi } from '../lib/api-access';
import {
  ADS_PAUSE_OFF_STATUS,
  ADS_PAUSE_ON_STATUS,
  BRAIN_PAUSE_ONLY,
  pauseCaller,
  pauseReturnWithNotice,
  pauseToggleView,
  safePauseReturn,
} from '../lib/ads-pause';
import { ADS_OWNER_UNPAUSE_PATH, adsSafetySettingsHref } from '../lib/module-origins';

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

type WriteCall = { workspaceId: string; applyKillSwitch: true };

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

  async function refusedUnpause(headers?: Record<string, string>) {
    const box = harness(true);
    const res = await postPause(request({ applyKillSwitch: false, confirm: true }, headers), box);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, BRAIN_PAUSE_ONLY);
    assert.equal(box.writes.length, 0);
  }

  await refusedUnpause();
  await refusedUnpause({ cookie: 'auth=console-secret' });
  await refusedUnpause({ 'x-cerevex-internal-key': 'internal-secret' });

  env.CONSOLE_OPERATOR_EMAIL = 'other@example.com';
  await refusedUnpause({ cookie: 'auth=console-secret' });
  const nonOwnerPause = harness(false);
  const nonOwnerPauseRes = await postPause(
    request({ applyKillSwitch: true }, { cookie: 'auth=console-secret' }),
    nonOwnerPause,
  );
  assert.equal(nonOwnerPauseRes.status, 200);
  assert.deepEqual(nonOwnerPause.writes, [{ workspaceId: WORKSPACE, applyKillSwitch: true }]);

  delete env.CONSOLE_OPERATOR_EMAIL;
  await refusedUnpause({ cookie: 'auth=console-secret' });
  const ownerPause = harness(false);
  const ownerPauseRes = await postPause(
    request({ applyKillSwitch: true }, { cookie: 'auth=console-secret' }),
    ownerPause,
  );
  assert.equal(ownerPauseRes.status, 200);
  assert.equal(ownerPause.writes.length, 1);

  const serviceOn = harness(false);
  const serviceOnRes = await postPause(
    request({ applyKillSwitch: true }, { 'x-cerevex-internal-key': 'internal-secret' }),
    serviceOn,
  );
  assert.equal(serviceOnRes.status, 200);
  assert.deepEqual(serviceOn.writes, [{ workspaceId: WORKSPACE, applyKillSwitch: true }]);

  const cross = harness(false);
  const crossRes = await postPause(
    request({ applyKillSwitch: true, workspaceId: OTHER }, { cookie: 'auth=console-secret' }),
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

  const anonPause = await postPause(request({ applyKillSwitch: true }), harness(false));
  assert.equal(anonPause.status, 401);

  const prevRailway = env.RAILWAY_ENVIRONMENT;
  const prevRailwayName = env.RAILWAY_ENVIRONMENT_NAME;
  delete env.APP_PASSWORD;
  delete env.RAILWAY_ENVIRONMENT;
  delete env.RAILWAY_ENVIRONMENT_NAME;
  env.NODE_ENV = 'development';
  assert.equal(pauseCaller({ cookie: null, internalKey: null }), 'session');
  assert.equal(pauseCaller({ cookie: null, internalKey: 'internal-secret' }), 'service');
  assert.notEqual(pauseCaller({ cookie: null, internalKey: null }), 'owner');
  assert.notEqual(pauseCaller({ cookie: null, internalKey: 'internal-secret' }), 'owner');
  await refusedUnpause();
  await refusedUnpause({ 'x-cerevex-internal-key': 'internal-secret' });
  const devPause = harness(false);
  const devPauseRes = await postPause(request({ applyKillSwitch: true }), devPause);
  assert.equal(devPauseRes.status, 200);
  assert.equal(devPause.writes.length, 1);
  const devKeyPause = harness(false);
  const devKeyPauseRes = await postPause(
    request({ applyKillSwitch: true }, { 'x-cerevex-internal-key': 'internal-secret' }),
    devKeyPause,
  );
  assert.equal(devKeyPauseRes.status, 200);
  assert.equal(devKeyPause.writes.length, 1);
  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  if (prevRailway === undefined) delete env.RAILWAY_ENVIRONMENT;
  else env.RAILWAY_ENVIRONMENT = prevRailway;
  if (prevRailwayName === undefined) delete env.RAILWAY_ENVIRONMENT_NAME;
  else env.RAILWAY_ENVIRONMENT_NAME = prevRailwayName;

  const paused = pauseToggleView({ killSwitchOn: true });
  const running = pauseToggleView({ killSwitchOn: false });
  assert.equal(paused.paused, true);
  assert.equal(paused.status, ADS_PAUSE_ON_STATUS);
  assert.equal(paused.showAdsTurnOn, true);
  assert.equal(paused.showPause, false);
  assert.equal(running.paused, false);
  assert.equal(running.status, ADS_PAUSE_OFF_STATUS);
  assert.equal(running.showPause, true);
  assert.equal(running.showAdsTurnOn, false);
  assert.equal(pauseToggleView({ killSwitchOn: null }).showPause, false);
  assert.equal(pauseToggleView({ killSwitchOn: null }).showAdsTurnOn, true);

  assert.equal(safePauseReturn('https://ads-web.example/app/settings'), '/settings#ads-pause');
  assert.equal(pauseReturnWithNotice('/ads', 'pause=saved'), '/ads?pause=saved');
  assert.equal(pauseReturnWithNotice('/settings#ads-pause', 'pause=saved'), '/settings?pause=saved#ads-pause');

  const here = dirname(fileURLToPath(import.meta.url));
  const brainRoot = join(here, '..');
  const prevOrigin = env.NEXT_PUBLIC_ADS_ORIGIN;
  env.NEXT_PUBLIC_ADS_ORIGIN = 'https://app.cerevex.store';
  assert.equal(ADS_OWNER_UNPAUSE_PATH, '/app/settings');
  assert.equal(adsSafetySettingsHref(), 'https://app.cerevex.store/app/settings');
  if (prevOrigin === undefined) delete env.NEXT_PUBLIC_ADS_ORIGIN;
  else env.NEXT_PUBLIC_ADS_ORIGIN = prevOrigin;

  const ownerPage = readFileSync(join(here, '../../ads/web/src/app/app/settings/page.tsx'), 'utf8');
  assert.match(ownerPage, /patchWorkspace\(\{\s*applyKillSwitch:\s*!killSwitch\s*\}\)/);

  const toggleSrc = readFileSync(join(brainRoot, 'components/ads/pause-toggle.tsx'), 'utf8');
  const settingsSrc = readFileSync(join(brainRoot, 'app/settings/page.tsx'), 'utf8');
  const cockpitSrc = readFileSync(join(brainRoot, 'app/ads/page.tsx'), 'utf8');
  const suggestionSrc = readFileSync(join(brainRoot, 'app/ads/suggestions/[id]/page.tsx'), 'utf8');
  const routeSrc = readFileSync(join(brainRoot, 'app/api/ads/pause/route.ts'), 'utf8');
  const bffSrc = readFileSync(join(brainRoot, 'lib/ads-bff.ts'), 'utf8');
  assert.ok(toggleSrc.includes('pauseToggleView'));
  assert.ok(toggleSrc.includes('ADS_PAUSE_ACTION'));
  assert.ok(toggleSrc.includes('ADS_TURN_ON_IN_ADS'));
  assert.ok(toggleSrc.includes('ADS_OWNER_UNPAUSE_PATH'));
  assert.ok(toggleSrc.includes('adsSafetySettingsHref'));
  assert.ok(toggleSrc.includes('href={adsOwnerHref}'));
  assert.ok(!toggleSrc.includes('name="confirm"'));
  assert.ok(!toggleSrc.includes('value="false"'));
  assert.ok(!toggleSrc.includes('href="/settings#ads-pause"'));
  assert.ok(!toggleSrc.includes('href="/ads"'));
  assert.ok(!toggleSrc.includes('/app/clients'));
  assert.ok(toggleSrc.includes('data-pause-state'));
  assert.ok(settingsSrc.includes('AdsPauseToggle'));
  assert.ok(cockpitSrc.includes('AdsPauseToggle'));
  assert.ok(suggestionSrc.includes('AdsPauseToggle'));
  assert.ok(!routeSrc.includes('ADS_API_TOKEN'));
  assert.ok(!routeSrc.includes('asOwner'));
  assert.ok(!bffSrc.includes('owner?:'));
  assert.ok(bffSrc.includes('safetyOn: false'));

  console.log('ads-pause: ok');
} finally {
  restore();
}
