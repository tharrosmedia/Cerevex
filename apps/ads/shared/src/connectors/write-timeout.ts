/**
 * Abort a platform write before the apply lease expires.
 * APPLYING_LEASE_MS is 120s. This stays well under that so a hung write cannot outlive the claim.
 */
export const PLATFORM_WRITE_TIMEOUT_MS = 30_000;

/** Whole executePrepared loop. Under the 120s lease, above one platform write. */
export const APPLY_EXECUTE_DEADLINE_MS = 90_000;
