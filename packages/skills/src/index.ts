export type {
  ApprovalStatus,
  ExecutedBy,
  NormalizedRecommendation,
  RecFormat,
  RecommendationApproval,
  RecommendationRecord,
  RecommendationVersions,
} from "./recommendation";
export {
  APPROVAL_STATUSES,
  EXECUTED_BY,
  REC_FORMAT_CURRENT,
  REC_FORMATS,
  RecommendationValidationError,
  normalizeRecommendation,
  validateRecommendation,
} from "./recommendation";

export type { PromptPrecedenceId } from "./prompt-layer";
export {
  PROMPT_LAYER_MISSING_FALLBACK,
  PROMPT_LAYER_PRECEDENCE,
  PROMPT_LAYER_SLUG,
  PROMPT_LAYER_VERSION,
  clientPromptLayerPath,
  higherPrecedence,
  storePromptLayerPath,
} from "./prompt-layer";

export {
  IN_SCOPE_CLIENT_SLUGS,
  LEVEL_AGENCY_TENANTS,
  SkillGateError,
  assertSkillRunAllowed,
  evaluateSkillRun,
  isInScopeClient,
  isLevelAgencyTenant,
  marketingGateFromStatus,
  normalizeTenantKey,
} from "./gates";

export {
  STALENESS_WINDOW_DAYS,
  classifyDatedRow,
  daysBetween,
  isMarkedVerify,
  parseVerifiedFactRows,
} from "./staleness";
export type { DatedRow } from "./staleness";

export {
  DEFAULT_APPROVAL_OWNER_IDENTITY,
  classifyProfileValue,
  decomposeProfileValue,
  resolveApprovalOwner,
  valueForClientFacingCopy,
} from "./fact";

export { importProfiles } from "./import-profiles";
export { missingFactsFor, renderMissingFacts } from "./missing-facts";
export { parseProfile, readProfileDir } from "./parse-profile";

export { HASH_ALGORITHM, buildManifest, readBannerVersion, readLibraryVersion } from "./manifest";
export {
  SkillVersionPinError,
  listPins,
  loadPromptLayerRef,
  loadSharedRef,
  loadTemplate,
  readCommittedManifest,
} from "./loader";

export type {
  ChannelFact,
  ClientSkillConfig,
  Fact,
  FactState,
  GateDecision,
  InScopeClientSlug,
  LoadedTemplate,
  ManifestEntry,
  MissingFactItem,
  PackId,
  PromptLayerSlot,
  ResolvedApprovalOwner,
  SkillConfigBundle,
  SkillRunKind,
  SkillSlug,
  SkillsManifest,
  StoreSkillConfig,
} from "./types";
export { FACT_STATES, SKILL_SLUGS } from "./types";
