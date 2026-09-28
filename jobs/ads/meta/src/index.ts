import { LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { metaAdsAccountSync } from "./functions/legacy-account-sync";

export { pullMetaAdAccount } from "./pull";
export { metaAdsAccountSync };

export const functions = [metaAdsAccountSync];
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.metaAdsAccountSync] as const;
