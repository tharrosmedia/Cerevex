import { ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { handleAuditRequested } from "../handlers";

export const auditRequested = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.auditRequested, name: "Ads audit requested", triggers: [{ event: EVENTS.auditRequested }] },
  handleAuditRequested,
);
