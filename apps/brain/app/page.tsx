import { listJobs } from '@/src/lib/db/jobs';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import AutoRefresh from '@/components/auto-refresh';
import { countOpenFindings } from '@/src/lib/db/findings';
import { getWorkspaceModuleSettings, saveBusinessType } from '@/src/lib/db/workspace-modules';
import { jobInputDetails, jobInputLabel, jobStatusLabel, jobTypeLabel } from '@/lib/job-labels';
import {
  ADS_MODULE_IDS,
  BUSINESS_TYPE_HELP,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  MODULE_COPY,
  isBusinessType,
  type BusinessType,
} from '@cerevex/contracts';

export const dynamic = 'force-dynamic';

async function chooseBusinessType(formData: FormData) {
  'use server';
  const value = formData.get('businessType');
  if (!isBusinessType(value)) {
    redirect('/?error=1');
  }
  await saveBusinessType(value as BusinessType);
  redirect('/');
}

export default async function CommandCenter({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as { error?: string };
  let storeId: string | null = null;
  let allStores: any[] = [];
  let loadError: string | null = null;
  try {
    storeId = await getActiveStoreId();
    allStores = await listStores();
    if (!storeId && allStores.length > 0) {
      storeId = allStores[0].id;
      const c = await cookies();
      if (storeId) {
        c.set('activeStoreId', storeId, {
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      }
    }
  } catch (e: any) {
    loadError = e.message || 'Failed to load data';
  }
  let jobs: any[] = [];
  let openFindings = 0;
  try {
    if (storeId) {
      jobs = await listJobs(storeId, 20);
      openFindings = await countOpenFindings(storeId);
    }
  } catch (e: any) {
    loadError = e.message || 'Failed to load data';
  }

  let onboardingComplete = true;
  let modules = {
    leads: true,
    clients: false,
    sales: false,
    workflows: true,
  };
  try {
    const settings = await getWorkspaceModuleSettings();
    onboardingComplete = settings.onboardingComplete;
    modules = settings.modules;
  } catch {}

  const awaitingApproval = jobs.filter((j: any) => j.status === 'awaiting_approval').length;
  const seoAwaiting = awaitingApproval;

  return (
    <div className="cx-page">
      <h1>Cerevex</h1>
      <p className="cx-lede">Ads and SEO for your store.</p>
      <AutoRefresh interval={4000} />

      {params.error ? (
        <p className="cx-banner cx-banner-warn">Could not save that choice. Try again.</p>
      ) : null}

      {!onboardingComplete && (
        <section>
          <h2>Choose your business type</h2>
          <p className="cx-help">This sets which Ads modules you see. You can change them later in Settings.</p>
          <div className="cx-card-grid home-types">
            {BUSINESS_TYPES.map((type) => (
              <form key={type} action={chooseBusinessType} className="cx-card">
                <input type="hidden" name="businessType" value={type} />
                <h3 className="cx-card-title">{BUSINESS_TYPE_LABELS[type]}</h3>
                <p className="cx-help">{BUSINESS_TYPE_HELP[type]}</p>
                <button type="submit" className="btn-cta">Use {BUSINESS_TYPE_LABELS[type]}</button>
              </form>
            ))}
          </div>
        </section>
      )}

      {allStores.length === 0 && (
        <section className="cx-panel">
          <h2>Add your store</h2>
          <p className="cx-help">Once a Shopify store is added, it is selected automatically.</p>
          <Link href="/stores" className="btn-cta">Go to stores</Link>
        </section>
      )}

      {loadError && (
        <p className="cx-banner cx-banner-warn">
          Could not load store data. Check the database connection, then refresh.
        </p>
      )}

      <section className="cx-card-grid home-modules" aria-label="Cerevex modules">
        <Link href="/seo" className="cx-card cx-card-linkable">
          <div className="cx-card-kicker">SEO</div>
          <p className="cx-stat">{seoAwaiting}</p>
          <p className="cx-help">{seoAwaiting === 1 ? 'page awaiting review' : 'pages awaiting review'}</p>
          <p className="cx-help">{openFindings} findings</p>
        </Link>
        <Link href="/seo/create" className="cx-card cx-card-linkable">
          <div className="cx-card-kicker">SEO</div>
          <p className="cx-stat cx-stat-text">New content</p>
          <p className="cx-help">Write a new page or post</p>
        </Link>
        <Link href="/review" className="cx-card cx-card-linkable">
          <div className="cx-card-kicker">Review</div>
          <p className="cx-stat">{awaitingApproval}</p>
          <p className="cx-help">items in the review queue</p>
        </Link>
        <Link href="/stores" className="cx-card cx-card-linkable">
          <div className="cx-card-kicker">Stores</div>
          <p className="cx-stat">{allStores.length}</p>
          <p className="cx-help">{allStores.length === 1 ? 'store connected' : 'stores connected'}</p>
        </Link>
        <Link href="/ads" className="cx-card cx-card-linkable">
          <div className="cx-card-kicker">Ads</div>
          <p className="cx-stat cx-stat-text">Check ads</p>
          <p className="cx-help">Audits, findings, and suggestions</p>
        </Link>
        {ADS_MODULE_IDS.filter((id) => modules[id]).map((id) => (
          <Link key={id} href={`/ads/${id}`} className="cx-card cx-card-linkable">
            <div className="cx-card-kicker">Ads</div>
            <p className="cx-stat cx-stat-text">{MODULE_COPY[id].label}</p>
            <p className="cx-help">{MODULE_COPY[id].help}</p>
          </Link>
        ))}
      </section>

      <section>
        <div className="cx-section-head">
          <h2>Recent jobs</h2>
          <Link href="/history" className="btn-secondary">Full history</Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Input</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && !loadError && (
                <tr>
                  <td colSpan={5}>No jobs yet for this store.</td>
                </tr>
              )}
              {jobs.map((job: any) => {
                const details = jobInputDetails(job.input);
                return (
                  <tr key={job.id}>
                    <td data-label="Type">{jobTypeLabel(job.type)}</td>
                    <td data-label="Input">
                      <div>{jobInputLabel(job.input, job.type)}</div>
                      {details.length > 0 ? (
                        <details className="cx-details">
                          <summary>Details</summary>
                          <ul>
                            {details.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td data-label="Status">{jobStatusLabel(job.status)}</td>
                    <td data-label="Created">{new Date(job.createdAt).toLocaleString()}</td>
                    <td data-label="Open">
                      <Link href={`/jobs/${job.id}`}>View</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
