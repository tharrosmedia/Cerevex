import { ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { handleStubPing } from "../handlers";

export const stubPing = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.stubPing, name: "Ads stub ping", triggers: [{ event: EVENTS.stubPing }] },
  handleStubPing,
);
