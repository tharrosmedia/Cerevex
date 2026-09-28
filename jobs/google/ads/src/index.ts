/**
 * Legacy-thin re-export. Implementation lives in @cerevex/jobs-ads-google.
 * Do not serve this package alongside that one — the function id would duplicate.
 * Remove this package when the dual-compat window closes.
 */
export { FUNCTION_IDS, functions, googleAdsAccountSync } from "@cerevex/jobs-ads-google";
