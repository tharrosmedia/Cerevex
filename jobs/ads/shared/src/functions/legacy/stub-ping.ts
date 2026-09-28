import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { inngest } from "@tharros/ads-shared/inngest";
import { handleStubPing } from "../../handlers";

/** One-release os/* listener. Do not emit. Remove when the dual-compat window closes. */
export const stubPingLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.stubPing,
    name: "Ads stub ping (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.stubPing }],
  },
  handleStubPing,
);
