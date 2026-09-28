import { ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { handleAccountSync } from "../handlers";

/**
 * Single canonical registration. Platform is event data.
 * Meta and Google pulls are jobs/ads/meta and jobs/ads/google.
 */
export const accountSync = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.accountSync, name: "Ads account sync", triggers: [{ event: EVENTS.accountSync }] },
  handleAccountSync,
);
