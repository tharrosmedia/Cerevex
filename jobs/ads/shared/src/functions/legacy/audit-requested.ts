import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { inngest } from "@tharros/ads-shared/inngest";
import { handleAuditRequested } from "../../handlers";

/** One-release os/* listener. Do not emit. Remove when the dual-compat window closes. */
export const auditRequestedLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.auditRequested,
    name: "Ads audit requested (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.auditRequested }],
  },
  handleAuditRequested,
);
