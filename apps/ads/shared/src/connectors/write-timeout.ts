/**
 * Abort a platform write before the apply lease expires.
 * APPLYING_LEASE_MS is 120s. This stays well under that so a hung write cannot outlive the claim.
 */
export const PLATFORM_WRITE_TIMEOUT_MS = 30_000;
