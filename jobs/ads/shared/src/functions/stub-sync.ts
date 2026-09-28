import { ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { handleStubSync } from "../handlers";

export const stubSync = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.stubSync, name: "Ads stub sync", triggers: [{ event: EVENTS.stubSync }] },
  handleStubSync,
);
