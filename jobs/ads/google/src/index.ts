import { ADS_FUNCTION_IDS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { googleAdsAccountSync } from "./functions/legacy-account-sync";
import { paidMediaGoogle } from "./functions/paid-media";

export { pullGoogleAdAccount } from "./pull";
export { googleAdsAccountSync, paidMediaGoogle };

export const functions = [googleAdsAccountSync, paidMediaGoogle];
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync, ADS_FUNCTION_IDS.paidMediaGoogle] as const;
