import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { isClientBusinessType } from '@/src/lib/db/client-workspace';
import { listStores, createStore, getStore, updateStore, getActiveStoreId } from '@/src/lib/db/stores';
import { inngest } from '@/src/inngest/client';
import { AddClientButton, AddClientFlow } from '@/components/add-client-flow';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SubmitButton } from '@/components/submit-button';
import { isWordpressConnectVisible } from '@cerevex/contracts';
import { WordpressAddSiteDownload } from '@/components/wordpress-add-site-download';
import { operatorLoadError, PICK_BUSINESS_TYPE } from '@/lib/ui-copy';
import { formatWhen, platformLabel } from '@/lib/labels';
import { verifyShopifyConnection } from '@/src/lib/shopify/verify';
import { hasShopifyAccessToken, SHOPIFY_NOT_CONNECTED_MESSAGE } from '@/src/lib/shopify/not-connected';
import { listAdsClients } from '@/lib/ads-bff';
import {
  addClientHref,
  clientWorkspaceRecord,
  decideClientIdentity,
  namedStores,
  planShopifyAdd,
  planWordpressAdd,
  setupHref,
  skillProfileSuggestions,
  wordpressConnectFailureMessage,
} from '@/lib/add-client-flow';
import {
  connectWordpressStore,
  decryptWordpressPluginKey,
  isWordpressStore,
  testWordpressConnection,
  wordpressConnectFlagsForAddSite,
  wordpressSiteUrl,
  wordpressWorkspaceSettingsFromStore,
} from '@/src/lib/wordpress';
import { isProductionRuntime } from '@/lib/runtime-env';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { authorizeApproveSession } from '@/lib/sensitive-auth';
import { loadSkillsProfileAction } from '@/lib/skills-profile-action';
import { SKILL_PROFILE_SLUGS } from '@/lib/skills-profile-slugs';
import { nameAndLinkSiteClient } from '@/lib/ads-client-link';
import { safeSetupNext } from '@/lib/client-setup-checklist';
import { loadSetupProgress } from '@/lib/client-setup-data';

type Platform = 'shopify' | 'wordpress';

function storesUrl(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/stores${s ? `?${s}` : ''}`;
}

async function setActiveStore(storeId: string) {
  const jar = await cookies();
  jar.set('activeStoreId', storeId, {
    path: '/',
    secure: isProductionRuntime(),
    sameSite: 'lax',
  });
}

function scopeWarning(missing: string[]): string | undefined {
  if (!missing.length) return undefined;
  return `The token is missing ${missing.join(', ')}. Some syncing or publishing will fail until you add ${missing.length > 1 ? 'these permissions' : 'this permission'} and paste a new token.`;
}

async function clientsForAdd() {
  try {
    const listed = await listAdsClients();
    if (!listed.ok) return [];
    return listed.data.clients.map((client) => ({ name: client.name, siteId: client.siteId }));
  } catch {
    return [];
  }
}

async function storesForAdd() {
  try {
    return namedStores(await listStores());
  } catch {
    return [];
  }
}

function flowBack(params: {
  step?: 'who' | 'site';
  name?: string;
  business?: string;
  platform?: string;
  match?: string;
  msg?: string;
}): never {
  redirect(addClientHref(params));
}

async function saveClientIdentity(formData: FormData) {
  'use server';
  const name = String(formData.get('name') || '');
  const businessType = String(formData.get('businessType') || '');
  const rawChoice = String(formData.get('choice') || 'continue');
  const choice = rawChoice === 'use' || rawChoice === 'new' ? rawChoice : 'continue';
  const decision = decideClientIdentity({
    name,
    businessType,
    choice,
    clients: await clientsForAdd(),
  });
  if (!decision.ok) {
    flowBack({
      step: 'who',
      name: decision.code === 'type-new' ? undefined : name.trim(),
      business: isClientBusinessType(businessType) ? businessType : undefined,
      match: decision.code === 'choose-existing' ? '1' : undefined,
      msg: decision.code === 'choose-existing' ? undefined : decision.message,
    });
  }
  flowBack({ step: 'site', name: decision.name, business: decision.businessType });
}

async function addShopifyStore(formData: FormData) {
  'use server';
  const name = String(formData.get('name') || '');
  const businessType = String(formData.get('businessType') || '');
  const connect = String(formData.get('connect') || '') === 'paste' ? 'paste' : 'later';
  const back = { step: 'site' as const, name: name.trim(), business: businessType, platform: 'shopify' };
  const plan = planShopifyAdd({
    name,
    businessType,
    domain: String(formData.get('shopify_domain') || ''),
    token: String(formData.get('shopify_access_token') || ''),
    connect,
    stores: await storesForAdd(),
  });
  if (!plan.ok) flowBack({ ...back, msg: plan.message });

  if (plan.mode === 'later') {
    const store = await createStore({
      name: plan.name,
      shopify_domain: plan.domain,
      shopify_access_token: null,
      platform: 'shopify',
      connector_type: 'shopify',
      config: plan.config,
    });
    await setActiveStore(store.id);
    const linked = await nameAndLinkSiteClient(store.id, store.name);
    revalidatePath('/stores');
    redirect(setupHref(store.id, linked.ok ? undefined : linked.message));
  }

  const verified = await verifyShopifyConnection(plan.domain, plan.token || '');
  if (!verified.ok) flowBack({ ...back, msg: `Could not connect: ${verified.error}` });
  const store = await createStore({
    name: plan.name,
    shopify_domain: plan.domain,
    shopify_access_token: plan.token,
    platform: 'shopify',
    connector_type: 'shopify',
    config: plan.config,
  });
  await setActiveStore(store.id);
  const linked = await nameAndLinkSiteClient(store.id, store.name);

  let warn = scopeWarning(verified.missingScopes);
  if (!linked.ok) warn = [warn, linked.message].filter(Boolean).join(' ');
  try {
    const { syncProductsForStore } = await import('@/src/lib/shopify/sync');
    await syncProductsForStore(store.id);
  } catch (e: any) {
    warn = [warn, `Products did not sync: ${e?.message || 'unknown error'}.`].filter(Boolean).join(' ');
  }
  try {
    await inngest.send({ name: 'seo/catalog.sync.requested', data: { storeId: store.id } });
  } catch (e) {
    console.warn('[stores] catalog sync enqueue failed', e);
  }
  revalidatePath('/stores');
  redirect(setupHref(store.id, warn));
}

async function addWordpressSite(formData: FormData) {
  'use server';
  const name = String(formData.get('name') || '');
  const businessType = String(formData.get('businessType') || '');
  const siteUrl = String(formData.get('siteUrl') || '');
  const back = { step: 'site' as const, name: name.trim(), business: businessType, platform: 'wordpress' };
  if (!isClientBusinessType(businessType)) flowBack({ step: 'who', name: name.trim(), msg: PICK_BUSINESS_TYPE });
  const planned = planWordpressAdd({ siteUrl, stores: await storesForAdd() });
  if (!planned.ok) flowBack({ ...back, msg: planned.message });

  const activeId = await getActiveStoreId();
  const active = activeId ? await getStore(activeId) : null;
  const result = await connectWordpressStore({
    storeId: null,
    workspaceSettings: wordpressWorkspaceSettingsFromStore(active),
    name,
    siteUrl,
    pluginKey: String(formData.get('pluginKey') || ''),
  });
  if (!result.ok) flowBack({ ...back, msg: wordpressConnectFailureMessage(result) });

  const created = result.storeId ? await getStore(result.storeId) : null;
  if (!created) flowBack({ ...back, msg: 'Could not connect the site.' });
  try {
    const current = created.config && typeof created.config === 'object' ? created.config : {};
    await updateStore(created.id, {
      name: created.name,
      shopify_domain: created.shopify_domain,
      shopify_access_token: '',
      platform: 'wordpress',
      connector_type: 'wordpress',
      config: { ...current, workspace: clientWorkspaceRecord(businessType) },
    });
  } catch (error) {
    console.warn('[stores] business type was not saved', error);
  }
  const linked = await nameAndLinkSiteClient(created.id, created.name);
  revalidatePath('/stores');
  redirect(setupHref(created.id, linked.ok ? undefined : linked.message));
}

async function testConnection(formData: FormData) {
  'use server';
  const storeId = String(formData.get('storeId') || '');
  const store = await getStore(storeId);
  if (!store) redirect(storesUrl({ test: 'error', msg: 'That store no longer exists.' }));
  if (isWordpressStore(store)) {
    const tested = await testWordpressConnection({
      siteUrl: wordpressSiteUrl(store),
      pluginKey: decryptWordpressPluginKey(store),
    });
    redirect(tested.ok
      ? storesUrl({ test: 'success', msg: `${store.name} is connected.` })
      : storesUrl({ test: 'error', msg: `${store.name}: ${tested.reason || 'could not reach the site.'}` }));
  }
  if (!hasShopifyAccessToken(store)) {
    redirect(storesUrl({ test: 'error', msg: SHOPIFY_NOT_CONNECTED_MESSAGE }));
  }
  const verified = await verifyShopifyConnection(store.shopify_domain, store.shopify_access_token);
  if (!verified.ok) redirect(storesUrl({ test: 'error', msg: `${store.name}: ${verified.error}` }));
  redirect(storesUrl({
    test: 'success',
    msg: `Connected to ${verified.shopName}.`,
    warn: scopeWarning(verified.missingScopes),
  }));
}

async function selectStore(formData: FormData) {
  'use server';
  await setActiveStore(String(formData.get('storeId') || ''));
  redirect('/');
}

async function openSetup(formData: FormData) {
  'use server';
  const storeId = String(formData.get('storeId') || '');
  const next = safeSetupNext(storeId, `/stores/${storeId}/setup`);
  if (!next) redirect('/stores');
  await setActiveStore(storeId);
  redirect(next);
}

type SearchParams = {
  flow?: string;
  step?: string;
  platform?: string;
  business?: string;
  match?: string;
  name?: string;
  msg?: string;
  warn?: string;
  test?: string;
  updated?: string;
  skills?: string;
};

export const dynamic = 'force-dynamic';

export default async function StoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const platform: Platform | null = params.platform === 'shopify' || params.platform === 'wordpress' ? params.platform : null;
  const flowName = typeof params.name === 'string' ? params.name : '';
  const flowBusiness = isClientBusinessType(params.business) ? params.business : '';
  const flow = params.flow === '1';
  const step: 'who' | 'site' = flow && params.step === 'site' && flowName && flowBusiness ? 'site' : 'who';
  const jar = await cookies();
  const ownerSession = authorizeApproveSession({
    cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null,
    internalKey: null,
  }).ok;
  let stores: any[] = [];
  let activeId: string | null = null;
  let loadError: string | null = null;
  try {
    stores = await listStores();
    activeId = await getActiveStoreId();
  } catch (e: any) {
    loadError = operatorLoadError(e.message) || 'Could not load stores.';
  }

  let setupProgress = new Map<string, string>();
  if (stores.length > 0) {
    try {
      setupProgress = await loadSetupProgress(stores);
    } catch {
      setupProgress = new Map();
    }
  }

  let suggestions: string[] = [];
  let existingClientName: string | null = null;
  if (flow) {
    const clients = await clientsForAdd();
    suggestions = skillProfileSuggestions({ stores, clients });
    if (params.match === '1' && flowName) {
      const decision = decideClientIdentity({
        name: flowName,
        businessType: flowBusiness || 'home_service',
        choice: 'continue',
        clients,
      });
      existingClientName = !decision.ok && decision.code === 'choose-existing' ? decision.existingName ?? null : null;
    }
  }

  let wordpressConnectVisible = false;
  if (flow && step === 'site' && platform === 'wordpress') {
    try {
      const active = stores.find((store) => store.id === activeId) ?? null;
      const flags = await wordpressConnectFlagsForAddSite(active);
      wordpressConnectVisible = isWordpressConnectVisible(flags);
    } catch {
      wordpressConnectVisible = false;
    }
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Stores"
        title="Stores"
        lede="Your Shopify stores and WordPress sites. Switch between them from the header."
        actions={flow ? undefined : <AddClientButton href={addClientHref({ step: 'who' })} />}
      />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">{loadError}</p> : null}
      {params.test === 'success' ? <p className="cx-banner" role="status">{params.msg}</p> : null}
      {params.test === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{params.msg}</p> : null}
      {params.warn ? <p className="cx-banner cx-banner-warn" role="status">{params.warn}</p> : null}
      {params.updated === '1' ? <p className="cx-banner" role="status">Store updated.</p> : null}
      {params.skills === 'loaded' ? <p className="cx-banner" role="status">{params.msg}</p> : null}
      {params.skills === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{params.msg}</p> : null}

      {stores.length > 0 ? (
        <section className="cx-panel">
          <h2>Your stores</h2>
          <ul className="cx-site-list">
            {stores.map((store: any) => {
              const isActive = store.id === activeId;
              const wordpress = (store.connector_type || store.platform) === 'wordpress';
              return (
                <li key={store.id} className="cx-card cx-site-card">
                  <div className="cx-site-card-head">
                    <h3 className="cx-card-title">{store.name}</h3>
                    {isActive ? <StatusBadge label="Selected" tone="trust" /> : null}
                  </div>
                  <p className="cx-card-meta">
                    {platformLabel(wordpress ? 'wordpress' : 'shopify')} · <span className="cx-site-domain">{store.shopify_domain}</span>
                  </p>
                  <p className="cx-card-meta">
                    {store.config?.catalogLastSynced
                      ? `Pages synced ${formatWhen(store.config.catalogLastSynced)}`
                      : 'Pages not synced yet'}
                  </p>
                  <div className="cx-actions">
                    {!isActive ? (
                      <form action={selectStore}>
                        <input type="hidden" name="storeId" value={store.id} />
                        <button type="submit" className="btn-secondary">Switch to this store</button>
                      </form>
                    ) : null}
                    <form action={testConnection}>
                      <input type="hidden" name="storeId" value={store.id} />
                      <SubmitButton className="btn-secondary" pendingLabel="Checking…">Check connection</SubmitButton>
                    </form>
                    <Link href={`/stores/${store.id}/edit`} className="btn-secondary">Edit</Link>
                    <form action={openSetup}>
                      <input type="hidden" name="storeId" value={store.id} />
                      <button type="submit" className="btn-secondary">
                        {setupProgress.get(store.id) ? `Setup · ${setupProgress.get(store.id)}` : 'Setup'}
                      </button>
                    </form>
                    {ownerSession ? (
                      <form action={loadSkillsProfileAction}>
                        <input type="hidden" name="storeId" value={store.id} />
                        <select name="slug" aria-label={`Skills profile for ${store.name}`} defaultValue="hvac-usa">
                          {SKILL_PROFILE_SLUGS.map((slug) => (
                            <option key={slug} value={slug}>{slug}</option>
                          ))}
                        </select>
                        <SubmitButton className="btn-secondary" pendingLabel="Loading…">Load skills profile</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {flow ? (
        <AddClientFlow
          step={step}
          name={flowName}
          businessType={flowBusiness}
          suggestions={suggestions}
          existingClientName={existingClientName}
          platform={platform}
          message={params.msg || null}
          identityAction={saveClientIdentity}
          shopifyAction={addShopifyStore}
          wordpress={platform === 'wordpress' && wordpressConnectVisible ? (
            <form action={addWordpressSite} className="cx-form">
              <input type="hidden" name="name" value={flowName} />
              <input type="hidden" name="businessType" value={flowBusiness} />
              <ol className="cx-help cx-steps">
                <li>
                  Download the Cerevex plugin (<WordpressAddSiteDownload visible />) and install it in WordPress.
                </li>
                <li>Copy the plugin key from Settings → Cerevex.</li>
              </ol>
              <div className="cx-field">
                <label htmlFor="wp-url">Site address</label>
                <input id="wp-url" name="siteUrl" placeholder="https://example.com" required />
              </div>
              <div className="cx-field">
                <label htmlFor="wp-key">Plugin key</label>
                <input id="wp-key" name="pluginKey" type="password" autoComplete="off" required />
              </div>
              <SubmitButton className="btn-cta" pendingLabel="Checking connection…">Connect site</SubmitButton>
            </form>
          ) : platform === 'wordpress' ? (
            <WordpressAddSiteDownload visible={false} />
          ) : null}
        />
      ) : null}
    </div>
  );
}
