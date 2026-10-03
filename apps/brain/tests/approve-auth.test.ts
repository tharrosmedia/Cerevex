import assert from 'node:assert/strict';
import { POST as approve } from '../app/api/approve/route';
import { postDecide } from '../app/api/ads/decide/route';

const env = process.env as Record<string, string | undefined>;
const prev = {
  APP_PASSWORD: env.APP_PASSWORD,
  ADS_INTERNAL_KEY: env.ADS_INTERNAL_KEY,
  APPROVE_OPERATOR_EMAILS: env.APPROVE_OPERATOR_EMAILS,
  CONSOLE_OPERATOR_EMAIL: env.CONSOLE_OPERATOR_EMAIL,
  NODE_ENV: env.NODE_ENV,
};

function restore() {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

function request(path: string, body: unknown, headers?: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

try {
  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  env.ADS_INTERNAL_KEY = 'internal-secret';
  delete env.APPROVE_OPERATOR_EMAILS;
  delete env.CONSOLE_OPERATOR_EMAIL;

  let sends = 0;
  const unauth = await approve(request('/api/approve', { jobId: 'job-1', status: 'approved' }), {
    send: async () => {
      sends += 1;
    },
  });
  assert.equal(unauth.status, 401);
  assert.equal(sends, 0);

  const tampered = await approve(
    request('/api/approve?x-cerevex-internal-key=internal-secret', { jobId: 'job-1', status: 'approved' }),
    {
      send: async () => {
        sends += 1;
      },
    },
  );
  assert.equal(tampered.status, 401);
  assert.equal(sends, 0);

  const wrong = await approve(
    request('/api/approve', { jobId: 'job-1', status: 'approved' }, { 'x-cerevex-internal-key': 'wrong' }),
    {
      send: async () => {
        sends += 1;
      },
    },
  );
  assert.equal(wrong.status, 401);
  assert.equal(sends, 0);

  env.APPROVE_OPERATOR_EMAILS = 'nobody@example.com';
  const forbidden = await approve(
    request('/api/approve', { jobId: 'job-1', status: 'approved' }, { cookie: 'auth=console-secret' }),
    {
      send: async () => {
        sends += 1;
      },
    },
  );
  assert.equal(forbidden.status, 403);
  assert.equal(sends, 0);
  delete env.APPROVE_OPERATOR_EMAILS;

  const ok = await approve(
    request('/api/approve', { jobId: 'job-1', status: 'approved' }, { cookie: 'auth=console-secret' }),
    {
      send: async (data) => {
        sends += 1;
        assert.equal((data as { jobId: string }).jobId, 'job-1');
      },
    },
  );
  assert.equal(ok.status, 200);
  assert.equal(sends, 1);

  const internal = await approve(
    request('/api/approve', { jobId: 'job-2', status: 'approved' }, { 'x-cerevex-internal-key': 'internal-secret' }),
    {
      send: async () => {
        sends += 1;
      },
    },
  );
  assert.equal(internal.status, 200);
  assert.equal(sends, 2);

  let forwards = 0;
  const decideUnauth = await postDecide(request('/api/ads/decide', { recommendationId: 'rec-1', action: 'approve' }), async () => {
    forwards += 1;
    return Response.json({ ok: true });
  });
  assert.equal(decideUnauth.status, 401);
  assert.equal(forwards, 0);

  const decideWrong = await postDecide(
    request('/api/ads/decide', { recommendationId: 'rec-1', action: 'approve' }, { 'x-cerevex-internal-key': 'wrong' }),
    async () => {
      forwards += 1;
      return Response.json({ ok: true });
    },
  );
  assert.equal(decideWrong.status, 401);
  assert.equal(forwards, 0);

  const decideQuery = await postDecide(
    request('/api/ads/decide?ADS_INTERNAL_KEY=internal-secret', { recommendationId: 'rec-1', action: 'authorize' }),
    async () => {
      forwards += 1;
      return Response.json({ ok: true });
    },
  );
  assert.equal(decideQuery.status, 401);
  assert.equal(forwards, 0);

  const decideOk = await postDecide(
    request('/api/ads/decide', { recommendationId: 'rec-1', action: 'approve', note: 'ship' }, { cookie: 'auth=console-secret' }),
    async (body) => {
      forwards += 1;
      assert.equal(body.action, 'approve');
      assert.equal(body.recommendationId, 'rec-1');
      return Response.json({ received: true, writes: false });
    },
  );
  assert.equal(decideOk.status, 200);
  assert.equal(forwards, 1);
  const decideBody = await decideOk.json();
  assert.equal(decideBody.writes, false);

  console.log('approve-auth: ok');
} finally {
  restore();
}
