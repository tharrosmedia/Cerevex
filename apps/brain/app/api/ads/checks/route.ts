import { NextResponse } from 'next/server';
import { adsApi, type AdsAudit } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    adAccountId?: string;
  };
  if (!body.clientId) {
    return NextResponse.json({ error: 'Choose a client first.' }, { status: 400 });
  }

  const payload = {
    adAccountId: body.adAccountId,
    inline: false,
  };

  const queued = await adsApi<{ audit: AdsAudit; status?: string; jobId?: string }>(
    `/clients/${body.clientId}/audits`,
    { method: 'POST', body: JSON.stringify(payload) },
  );

  if (queued.ok) {
    return NextResponse.json({
      audit: queued.data.audit,
      status: queued.data.audit.status,
      jobId: queued.data.jobId ?? null,
      inline: false,
    });
  }

  if (queued.status === 503) {
    const inline = await adsApi<{ audit: AdsAudit }>(`/clients/${body.clientId}/audits`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, inline: true }),
    });
    if (inline.ok) {
      return NextResponse.json({
        audit: inline.data.audit,
        status: inline.data.audit.status,
        jobId: null,
        inline: true,
      });
    }
    return NextResponse.json({ error: inline.message }, { status: inline.status || 502 });
  }

  return NextResponse.json({ error: queued.message }, { status: queued.status || 502 });
}
