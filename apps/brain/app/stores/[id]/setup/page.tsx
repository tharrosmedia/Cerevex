import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ClientSetupChecklist } from '@/components/client-setup-checklist';
import { PageHeader } from '@/components/page-header';
import { operatorLoadError } from '@/lib/ui-copy';
import { loadChecklistForStore } from '@/lib/client-setup-data';
import { safeSetupNext } from '@/lib/client-setup-checklist';
import { loadSkillsProfileAction } from '@/lib/skills-profile-action';
import { isProductionRuntime } from '@/lib/runtime-env';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { authorizeApproveSession } from '@/lib/sensitive-auth';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';

export const dynamic = 'force-dynamic';

async function selectStore(storeId: string) {
  const jar = await cookies();
  jar.set('activeStoreId', storeId, {
    path: '/',
    secure: isProductionRuntime(),
    sameSite: 'lax',
  });
}

async function openNext(formData: FormData) {
  'use server';
  const storeId = String(formData.get('storeId') || '');
  const next = safeSetupNext(storeId, String(formData.get('next') || ''));
  if (!next) redirect('/stores');
  await selectStore(storeId);
  redirect(next);
}

export default async function StoreSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skills?: string; msg?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const jar = await cookies();
  const owner = authorizeApproveSession({
    cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null,
    internalKey: null,
  }).ok;

  let store: Awaited<ReturnType<typeof getStore>> | null = null;
  let loadError: string | null = null;
  try {
    store = await getStore(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    loadError = operatorLoadError(message) || 'Could not load this store.';
  }

  if (!store) {
    return (
      <div className="cx-page">
        <PageHeader title={loadError ? 'Could not load store' : 'Store not found'} backHref="/stores" backLabel="← Stores" />
        <p className="cx-help">{loadError || 'That store was removed or the link is wrong.'}</p>
        <Link href="/stores" className="btn-cta">Back to stores</Link>
      </div>
    );
  }

  const activeId = await getActiveStoreId();
  const model = await loadChecklistForStore(store, owner);
  const selected = activeId === store.id;

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Setup"
        title={store.name}
        lede={model.requiredComplete
          ? `Required setup is done. ${model.progressLabel}.`
          : `${model.progressLabel}. What's connected, and what to do next.`}
        backHref="/stores"
        backLabel="← Stores"
      />
      {query.skills === 'loaded' ? <p className="cx-banner" role="status">{query.msg || 'Skills profile loaded.'}</p> : null}
      {query.skills === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{query.msg || 'Could not load that profile.'}</p> : null}
      {selected ? null : (
        <form action={openNext} className="cx-banner">
          <p>This checklist is for {store.name}. Switch to it so the next step uses this store.</p>
          <input type="hidden" name="storeId" value={store.id} />
          <input type="hidden" name="next" value={`/stores/${store.id}/setup`} />
          <button type="submit" className="btn-secondary">Switch to this store</button>
        </form>
      )}
      <ClientSetupChecklist model={model} continueAction={openNext} skillsAction={loadSkillsProfileAction} />
    </div>
  );
}
