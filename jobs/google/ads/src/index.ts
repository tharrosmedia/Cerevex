/**
 * Legacy-thin re-export. Implementation lives in @cerevex/jobs-ads-google.
 * Do not serve this package alongside that one — the function id would duplicate.
 * This package stays on the one-release google listener only. Skill jobs are
 * registered from @cerevex/jobs-ads-google, not from here.
 */
import { googleAdsAccountSync } from "@cerevex/jobs-ads-google";

export { googleAdsAccountSync };
export const functions = [googleAdsAccountSync];
export const FUNCTION_IDS = ["google-ads-account-sync"] as const;
