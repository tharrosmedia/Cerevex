import { seoJob } from './functions/job';
import { researchFn } from './functions/research';
import { createBriefFn } from './functions/create-brief';
import { writeDraftFn } from './functions/write-draft';
import { editDraftFn } from './functions/edit-draft';
import { optimizeDraftFn } from './functions/optimize-draft';
import { evaluateFn } from './functions/evaluate';
import { gradeDraftFn } from './functions/grade-draft';
import { reviseDraftFn } from './functions/revise-draft';
import { saveDraftFn } from './functions/save-draft';
import { saveApprovalFn } from './functions/save-approval';
import { publishFn } from './functions/publish';
import { ensureJob } from './functions/ensure-job';
import { updateJobStatusFn } from './functions/update-job-status';
import { logEventFn } from './functions/log-event';
import { catalogSyncFn } from './functions/catalog-sync';
import { gscSyncFn } from './functions/gsc-sync';
import { auditFn } from './functions/audit';
import { wordpressSyncFn } from './functions/wordpress-sync';
import { wordpressApplyFn } from './functions/wordpress-apply';

export { inngest } from './client';

/**
 * SEO Inngest functions registered by Brain `/api/inngest`.
 * Event names remain `seo/*`. Function IDs remain `seo-*` (plus
 * existing helper IDs `update-job-status` and `log-event`).
 * Do not mass-rename to `brain/*`.
 */
export const functions = [
  seoJob,
  ensureJob,
  researchFn,
  createBriefFn,
  writeDraftFn,
  editDraftFn,
  optimizeDraftFn,
  evaluateFn,
  gradeDraftFn,
  reviseDraftFn,
  saveDraftFn,
  saveApprovalFn,
  publishFn,
  updateJobStatusFn,
  logEventFn,
  catalogSyncFn,
  gscSyncFn,
  auditFn,
  wordpressSyncFn,
  wordpressApplyFn,
];
