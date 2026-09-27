import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  isWordpressApplyVisible,
  isWordpressApplyWritable,
  parseWordpressCatalogResourceType,
  parseWordpressExternalCatalogId,
  siteCmsPlainError,
} from '@cerevex/contracts';
import { PageHeader } from '@/components/page-header';
import { SubmitButton } from '@/components/submit-button';
import { resourceTypeLabel } from '@/lib/labels';
import { getCatalogResource } from '@/src/lib/db/catalog';
import { createJob } from '@/src/lib/db/jobs';
import { saveDraft } from '@/src/lib/db/drafts';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { logEvent } from '@/src/lib/brain/events';
import { isWordpressStore, wordpressFlagsFromStore } from '@/src/lib/wordpress';

export const dynamic = 'force-dynamic';

export default async function SeoLiveResource({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = (await (searchParams ?? Promise.resolve({}))) as { error?: string };
  const resource = await getCatalogResource(id).catch(() => null);
  if (!resource) notFound();

  const storeId = await getActiveStoreId();
  const store = storeId ? await getStore(storeId).catch(() => null) : null;
  const flags = wordpressFlagsFromStore(store);
  const wpType = parseWordpressCatalogResourceType(resource.resourceType);
  const canPropose = Boolean(wpType && isWordpressStore(store) && isWordpressApplyVisible(flags));
  const canApply = isWordpressApplyWritable(flags);

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title={resource.title || 'Page'}
        lede={[
          resourceTypeLabel(resource.resourceType),
          `/${resource.handle || ''}`,
          resource.seoTitle ? `SEO title: ${resource.seoTitle}` : 'No SEO title',
        ].join(' · ')}
        backHref="/seo/live"
        backLabel="← Live catalog"
      />
      {query.error ? <p className="cx-banner cx-banner-warn" role="status">{query.error}</p> : null}
      <div className="cx-panel">
        <h2>Current content</h2>
        <div className="cx-html-preview" dangerouslySetInnerHTML={{ __html: resource.bodyHtml || '' }} />
      </div>
      {canPropose ? (
        <form action={proposeWordpressChange} className="cx-panel cx-form">
          <h2>Propose a change</h2>
          <input type="hidden" name="resourceId" value={resource.id} />
          <div className="cx-field">
            <label htmlFor="wp-title">Title</label>
            <input id="wp-title" name="title" defaultValue={resource.title || ''} />
          </div>
          <div className="cx-field">
            <label htmlFor="wp-meta-title">Meta title</label>
            <input id="wp-meta-title" name="metaTitle" defaultValue={resource.seoTitle || ''} />
          </div>
          <div className="cx-field">
            <label htmlFor="wp-meta-desc">Meta description</label>
            <input id="wp-meta-desc" name="metaDescription" defaultValue={resource.seoDescription || ''} />
          </div>
          <div className="cx-field">
            <label htmlFor="wp-body">Body</label>
            <textarea id="wp-body" name="bodyHtml" defaultValue={resource.bodyHtml || ''} />
          </div>
          {!canApply ? (
            <p className="cx-help">Publishing to WordPress is turned off, so approving this will not change your site yet.</p>
          ) : null}
          <SubmitButton className="btn-cta" pendingLabel="Sending…">Send to Review</SubmitButton>
        </form>
      ) : wpType ? (
        <p className="cx-help">
          To propose changes here, connect WordPress and turn on WordPress changes in <Link href="/settings#connects">Settings</Link>.
        </p>
      ) : (
        <p className="cx-help">
          Editing this page from here isn&apos;t available yet. Use <Link href="/seo/findings">Recommendations</Link> to draft improvements.
        </p>
      )}
    </div>
  );
}

async function proposeWordpressChange(formData: FormData) {
  'use server';
  const resourceId = String(formData.get('resourceId') || '');
  const resource = await getCatalogResource(resourceId);
  if (!resource) redirect('/seo/live');
  const storeId = resource.storeId || await getActiveStoreId();
  if (!storeId) redirect('/seo/live');
  const store = await getStore(storeId);
  if (!store || !isWordpressStore(store)) redirect('/seo/live');
  const flags = wordpressFlagsFromStore(store);
  if (!isWordpressApplyVisible(flags)) {
    redirect(`/seo/live/${resourceId}?error=` + encodeURIComponent(siteCmsPlainError('capability_off')));
  }
  const parsed = parseWordpressExternalCatalogId(resource.shopifyId) || {
    resourceType: parseWordpressCatalogResourceType(resource.resourceType) || 'page',
    externalId: resource.externalId || resource.shopifyId,
  };
  const title = String(formData.get('title') || resource.title || '');
  const handle = resource.handle || '';
  const bodyHtml = String(formData.get('bodyHtml') || resource.bodyHtml || '');
  const metaTitle = String(formData.get('metaTitle') || resource.seoTitle || '');
  const metaDescription = String(formData.get('metaDescription') || resource.seoDescription || '');
  const job = await createJob({
    storeId,
    domain: 'seo',
    type: 'seo.wordpress',
    input: {
      resourceType: parsed.resourceType,
      externalId: parsed.externalId,
      catalogId: resource.id,
      title,
      handle,
    },
    status: 'awaiting_approval',
  });
  await saveDraft({
    jobId: job.id,
    storeId,
    title,
    handle,
    bodyHtml,
    metaTitle,
    metaDescription,
    brief: {
      connectorType: 'wordpress',
      resourceType: parsed.resourceType,
      externalId: parsed.externalId,
      before: {
        title: resource.title,
        seoTitle: resource.seoTitle,
        seoDescription: resource.seoDescription,
      },
    },
  });
  await logEvent(storeId, 'human', 'wordpress.proposed', {
    jobId: job.id,
    externalId: parsed.externalId,
    resourceType: parsed.resourceType,
  }, job.id);
  redirect('/review?success=proposed');
}
