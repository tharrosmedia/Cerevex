import { LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { APPLY_WORKER_CONCURRENCY } from "@tharros/ads-shared/db";
import { inngest } from "@tharros/ads-shared/inngest";
import { handleApplyRequested } from "../../handlers";

/** One-release os/* listener. Do not emit. Remove when the dual-compat window closes. */
export const applyRequestedLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.applyRequested,
    name: "Ads apply requested (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.applyRequested }],
    idempotency: "event.data.applyJobId",
    concurrency: { limit: APPLY_WORKER_CONCURRENCY },
  },
  handleApplyRequested,
);
