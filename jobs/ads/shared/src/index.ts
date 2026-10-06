import { ADS_FUNCTION_IDS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { accountReview } from "./functions/account-review";
import { accountSync } from "./functions/account-sync";
import { applyRequested } from "./functions/apply-requested";
import { auditRequested } from "./functions/audit-requested";
import { applyRequestedLegacy } from "./functions/legacy/apply-requested";
import { auditRequestedLegacy } from "./functions/legacy/audit-requested";
import { stubPingLegacy } from "./functions/legacy/stub-ping";
import { stubSyncLegacy } from "./functions/legacy/stub-sync";
import { stubPing } from "./functions/stub-ping";
import { stubSync } from "./functions/stub-sync";

export {
  accountReview,
  accountSync,
  applyRequested,
  applyRequestedLegacy,
  auditRequested,
  auditRequestedLegacy,
  stubPing,
  stubPingLegacy,
  stubSync,
  stubSyncLegacy,
};

/**
 * Cross-platform ads functions registered by apps/ads/workers on cerevex-ads.
 * Event names remain ads/* (plus one-release os/*). Function ids remain ads-*
 * (plus one-release os-*). Do not mass-rename.
 */
export const functions = [
  stubPing,
  stubPingLegacy,
  stubSync,
  stubSyncLegacy,
  applyRequested,
  applyRequestedLegacy,
  auditRequested,
  auditRequestedLegacy,
  accountSync,
  accountReview,
];

export const FUNCTION_IDS = [
  ADS_FUNCTION_IDS.stubPing,
  LEGACY_ADS_FUNCTION_IDS.stubPing,
  ADS_FUNCTION_IDS.stubSync,
  LEGACY_ADS_FUNCTION_IDS.stubSync,
  ADS_FUNCTION_IDS.applyRequested,
  LEGACY_ADS_FUNCTION_IDS.applyRequested,
  ADS_FUNCTION_IDS.auditRequested,
  LEGACY_ADS_FUNCTION_IDS.auditRequested,
  ADS_FUNCTION_IDS.accountSync,
  ADS_FUNCTION_IDS.accountReview,
] as const;
