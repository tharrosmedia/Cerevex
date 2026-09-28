import { functions as googleAdsFunctions, FUNCTION_IDS as GOOGLE_ADS_IDS } from "@cerevex/jobs-ads-google";
import { functions as metaAdsFunctions, FUNCTION_IDS as META_ADS_IDS } from "@cerevex/jobs-ads-meta";
import { functions as sharedAdsFunctions, FUNCTION_IDS as SHARED_ADS_IDS } from "@cerevex/jobs-ads-shared";

/**
 * Functions served on cerevex-ads.
 * Legacy @cerevex/jobs-meta-ads and @cerevex/jobs-google-ads re-export the
 * platform packages. Do not spread those arrays here — the ids would duplicate.
 */
export const functions = [...sharedAdsFunctions, ...metaAdsFunctions, ...googleAdsFunctions];

export const FUNCTION_IDS = [...SHARED_ADS_IDS, ...META_ADS_IDS, ...GOOGLE_ADS_IDS] as const;
