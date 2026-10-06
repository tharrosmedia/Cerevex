import { ADS_FUNCTION_IDS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { metaAdsAccountSync } from "./functions/legacy-account-sync";
import { paidMediaMeta } from "./functions/paid-media";

export { pullMetaAdAccount } from "./pull";
export { metaAdsAccountSync, paidMediaMeta };

export const functions = [metaAdsAccountSync, paidMediaMeta];
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync, ADS_FUNCTION_IDS.paidMediaMeta] as const;
