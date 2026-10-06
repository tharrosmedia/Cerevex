/**
 * Legacy-thin re-export. Implementation lives in @cerevex/jobs-ads-meta.
 * Do not serve this package alongside that one — the function id would duplicate.
 * This package stays on the one-release meta listener only. Skill jobs are
 * registered from @cerevex/jobs-ads-meta, not from here.
 */
import { metaAdsAccountSync } from "@cerevex/jobs-ads-meta";

export { metaAdsAccountSync };
export const functions = [metaAdsAccountSync];
export const FUNCTION_IDS = ["meta-ads-account-sync"] as const;
