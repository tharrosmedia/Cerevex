/**
 * Client and store skill config produced by the one-way profile import.
 *
 * Tenancy (Architecture 1.0): client fields hang off clientId; store fields
 * hang off store_id. Ad accounts stay on clientId and are not part of this
 * import. Brain rows stay store_id-keyed; `brainStoreId` is filled later,
 * with no cross-schema foreign key.
 *
 * Prompt layers are seeded for the HVAC USA pilot. Other clients stay an empty slot.
 */

export const FACT_STATES = ["known", "tbd", "inference", "assumption"] as const;
export type FactState = (typeof FACT_STATES)[number];

export interface Fact<T = string> {
  state: FactState;
  /** Null when state is `tbd`. Inference and assumption values must not be used in client-facing copy. */
  value: T | null;
  source: string | null;
  asOf: string | null;
  /** Profile text this fact was parsed from. */
  raw: string;
}

export type InScopeClientSlug =
  | "hvac-usa"
  | "got-ductless"
  | "kc-prestige-hvac"
  | "elmar-hvac"
  | "tharros-media"
  | "cerevex";

export type PackId = "home-service" | "ecommerce-dtc" | "saas-b2b" | "local-other";

export interface PackRef {
  id: PackId;
  /** Shared-library version. Packs in this snapshot do not carry their own semver. */
  version: string;
  role: "primary" | "rule-set" | "fallback";
  sections: string[];
}

export interface ChannelFact {
  channel: string;
  status: Fact<string>;
  access: Fact<string>;
  notes: Fact<string>;
}

export interface MeasurementConfig {
  summary: Fact<string>;
  conversionTrackingAudit: Fact<string>;
  callTracking: Fact<string> | null;
  crm: Fact<string> | null;
  clickIdCapture: Fact<string> | null;
  pixels: Fact<string> | null;
  ecommercePlatform: Fact<string> | null;
}

export type StoreRole = "web" | "storefront" | "service-area" | "product";

/** Client or store prompt layer. Slice 1 seeds HVAC USA only. Other clients stay empty. */
export interface PromptLayerSlot {
  seeded: boolean;
  /** `hvac-usa@v1` when seeded. Null when the layer has not been seeded. */
  version: string | null;
  /** Canonical box path: `clients/<client>/prompt-layer.md` or `clients/<client>/prompt-layer-<store>.md`. */
  path: string;
}

export interface StoreSkillConfig {
  storeKey: string;
  role: StoreRole;
  /** Brain `stores.id` when a console store exists. Null until linked. No FK across schemas. */
  brainStoreId: string | null;
  site: Fact<string> | null;
  cms: Fact<string> | null;
  geo: Fact<string> | null;
  channels: ChannelFact[];
  /** True when the profile says the client has no channels. */
  channelsDeclaredNone: boolean;
  measurement: MeasurementConfig;
  capacity: Fact<string> | null;
  lag: Fact<string> | null;
  valueModelOverride: Fact<string> | null;
  segmentsOverride: Fact<string> | null;
  notes: Fact<string>[];
  promptLayer: PromptLayerSlot;
}

export interface IndexedFact {
  field: string;
  layer: "client" | "store";
  storeKey: string | null;
  fact: Fact<unknown>;
}

/**
 * Identity for a resolved approval owner. Not an email.
 * Binding this identity to `os.users` is the ads import's job (`APPROVAL_OWNER_USER_ID`
 * or the workspace membership with role `owner`).
 */
export interface ResolvedApprovalOwner {
  name: string;
  role: "approver-and-admin" | "approver";
  resolvedFrom: "tbd-default" | "agency-owner" | "profile";
}

export interface FactsRegisterRow {
  fact: string;
  source: string;
  date: string;
  state: FactState;
}

export interface ClientSkillConfig {
  slug: InScopeClientSlug;
  displayName: string;
  snapshotId: string;
  profileHash: string;
  profileUpdatedAt: string;
  /** HVAC USA is the only slice 1 pilot (brief §7). */
  pilot: boolean;
  marketingGate: "on" | "off";
  scopeAllowed: true;
  /** Tharros and Cerevex marketing never name a client or cite client results (§3.4). */
  forbidClientNamesAndResults: boolean;
  engagement: Fact<string>;
  profileStatus: Fact<string>;
  approvalOwner: Fact<string>;
  approvalOwnerResolved: ResolvedApprovalOwner;
  packs: PackRef[];
  /** Set when the profile names a pack that is not active while the marketing gate is on. */
  dormantPackId: PackId | null;
  businessModel: Fact<string>;
  offer: Fact<string>;
  qualifiedOutcome: Fact<string>;
  secondaryOutcome: Fact<string> | null;
  valueModel: Fact<string>;
  segments: Fact<string>;
  qualifyingRules: Fact<string> | null;
  voice: Fact<string>;
  protectedLines: Fact<string> | null;
  neverSay: Fact<string> | null;
  complianceRules: Fact<string>;
  copyRules: Fact<string> | null;
  voiceDetail: Fact<string> | null;
  installs: Fact<string> | null;
  brands: Fact<string> | null;
  licenses: Fact<string> | null;
  dealerAuthorization: Fact<string> | null;
  planningNote: Fact<string> | null;
  factsRegister: FactsRegisterRow[];
  openQuestions: string[];
  stores: StoreSkillConfig[];
  /** Extra decomposed clauses (TBD gaps, labeled inferences) that are not the primary field. */
  extras: IndexedFact[];
  promptLayer: PromptLayerSlot;
}

export interface MissingFactItem {
  field: string;
  layer: "client" | "store";
  storeKey: string | null;
  label: string;
  origin: "tbd-field" | "open-question";
}

export interface SkillConfigBundle {
  snapshotId: string;
  libraryVersion: string;
  generatedFrom: "vendored-profiles";
  clients: ClientSkillConfig[];
  missingFacts: Record<InScopeClientSlug, MissingFactItem[]>;
  missingFactsMarkdown: Record<InScopeClientSlug, string>;
}

export type SkillSlug =
  | "paid-media"
  | "seo-audit"
  | "seo-research"
  | "claims-check"
  | "no-slop-copy"
  | "account-review-loop";

export const SKILL_SLUGS: readonly SkillSlug[] = [
  "paid-media",
  "seo-audit",
  "seo-research",
  "claims-check",
  "no-slop-copy",
  "account-review-loop",
];

export type ManifestKind = "skill" | "shared-ref";

export interface ManifestFile {
  path: string;
  sha256: string;
}

export interface ManifestEntry {
  slug: string;
  kind: ManifestKind;
  version: string;
  /** Banner `> version` under frontmatter, or the shared-library version when a ref has no banner. */
  versionSource: "banner" | "library-skill-header";
  contentHash: string;
  files: ManifestFile[];
}

export interface SkillsManifest {
  snapshotId: string;
  snapshotTimestamp: string;
  libraryVersion: string;
  algorithm: "sha256-sorted-path-v1";
  entries: ManifestEntry[];
}

export interface LoadedTemplate {
  readonly slug: string;
  readonly kind: ManifestKind;
  readonly version: string;
  readonly contentHash: string;
  readonly files: readonly ManifestFile[];
  /** Primary markdown body (SKILL.md or the shared ref file). */
  readonly body: string;
  /** Read a file inside this pin. Paths that escape the pin throw. */
  read(relativePath: string): string;
}

export type SkillRunKind = "marketing" | "qualified-outcome" | "internal-record";

export interface GateDecision {
  allowed: boolean;
  gate: "scope" | "marketing" | null;
  reason: string | null;
}
