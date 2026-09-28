import { LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { googleAdsAccountSync } from "./functions/legacy-account-sync";

export { pullGoogleAdAccount } from "./pull";
export { googleAdsAccountSync };

export const functions = [googleAdsAccountSync];
export const FUNCTION_IDS = [LEGACY_ADS_FUNCTION_IDS.googleAdsAccountSync] as const;
