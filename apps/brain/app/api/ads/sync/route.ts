import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountIds?: unknown;
    clientId?: string;
  };

  let accountIds = Array.isArray(body.accountIds)
    ? body.accountIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  if (accountIds.length === 0 && body.clientId) {
    const accounts = await adsApi<{ adAccounts?: Array<{ id?: string }> }>(`/clients/${body.clientId}/ad-accounts`);
    if (!accounts.ok) {
      return NextResponse.json({ error: accounts.message }, { status: accounts.status || 502 });
    }
    accountIds = (accounts.data.adAccounts ?? [])
      .map((row) => row.id)
      .filter((id): id is string => Boolean(id));
  }

  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'Connect Meta or Google first.' }, { status: 400 });
  }

  const queued: string[] = [];
  const errors: string[] = [];
  for (const accountId of accountIds) {
    const result = await adsApi<{ adAccountId?: string; status?: string }>(`/ad-accounts/${accountId}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (result.ok) {
      queued.push(result.data.adAccountId ?? accountId);
    } else {
      errors.push(result.message);
    }
  }

  if (queued.length === 0) {
    return NextResponse.json({ error: errors[0] || 'Could not queue sync.' }, { status: 502 });
  }
  return NextResponse.json({ queued: queued.length, accountIds: queued, errors });
}
