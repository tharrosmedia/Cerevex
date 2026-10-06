'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { postPause } from '@/app/api/ads/pause/route';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { ADS_PAUSE_SAVED_ON, pauseReturnWithNotice, safePauseReturn } from '@/lib/ads-pause';

export async function submitAdsPause(formData: FormData) {
  const jar = await cookies();
  const auth = jar.get(AUTH_COOKIE_NAME)?.value;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(auth)}`;
  const applyKillSwitch = String(formData.get('applyKillSwitch')) === 'true';
  const returnTo = safePauseReturn(String(formData.get('returnTo') ?? ''));
  const response = await postPause(
    new Request('http://brain.local/api/ads/pause', {
      method: 'POST',
      headers,
      body: JSON.stringify({ applyKillSwitch }),
    }),
  );
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  revalidatePath('/settings');
  revalidatePath('/ads');
  const query = response.ok
    ? `pause=saved&message=${encodeURIComponent(ADS_PAUSE_SAVED_ON)}`
    : `pause=error&message=${encodeURIComponent(body?.error || 'Could not update ads pause.')}`;
  redirect(pauseReturnWithNotice(returnTo, query));
}
