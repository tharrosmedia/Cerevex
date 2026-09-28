import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { inngest } from "@tharros/ads-shared/inngest";
import { handleStubSync } from "../../handlers";

/** One-release os/* listener. Do not emit. Remove when the dual-compat window closes. */
export const stubSyncLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.stubSync,
    name: "Ads stub sync (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.stubSync }],
  },
  handleStubSync,
);
