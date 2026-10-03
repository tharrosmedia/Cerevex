import { ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { APPLY_WORKER_CONCURRENCY } from "@tharros/ads-shared/db";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { handleApplyRequested } from "../handlers";

export const applyRequested = inngest.createFunction(
  {
    id: ADS_FUNCTION_IDS.applyRequested,
    name: "Ads apply requested",
    triggers: [{ event: EVENTS.applyRequested }],
    idempotency: "event.data.applyJobId",
    concurrency: { limit: APPLY_WORKER_CONCURRENCY },
  },
  handleApplyRequested,
);
