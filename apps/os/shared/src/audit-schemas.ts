import { z } from "zod";
import {
  FINDING_SEVERITIES,
  RECOMMENDATION_RISKS,
  RECOMMENDATION_SCHEMA_VERSION,
  RECOMMENDATION_TYPES,
} from "./types";

/** Proposed platform mutation. `execute` is locked false — M3 never writes Meta/Google. */
export const proposedMutationSchema = z.object({
  platform: z.enum(["meta", "google"]),
  action: z.enum(["pause", "update_budget", "update_bid", "create_ad", "add_keyword", "review"]),
  target: z.object({
    entityType: z.string().min(1),
    externalId: z.string().min(1),
    name: z.string().optional(),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
  execute: z.literal(false),
});

export type ProposedMutation = z.infer<typeof proposedMutationSchema>;

export const findingDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid().nullable(),
  auditRunId: z.string().uuid(),
  severity: z.enum(FINDING_SEVERITIES),
  title: z.string().min(1).max(200),
  bodyJson: z
    .object({
      ruleId: z.string().min(1),
      writes: z.literal(false),
      adAccountId: z.string().uuid().optional(),
      platform: z.enum(["meta", "google"]).optional(),
    })
    .loose(),
});

export type FindingDraft = z.infer<typeof findingDraftSchema>;

export const recommendationDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  clientId: z.string().uuid(),
  adAccountId: z.string().uuid(),
  type: z.enum(RECOMMENDATION_TYPES),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(4000),
  estimatedImpactUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable(),
  risk: z.enum(RECOMMENDATION_RISKS),
  confidence: z
    .string()
    .regex(/^0\.\d{1,4}$|^1(\.0{1,4})?$/)
    .nullable(),
  evidenceJson: z
    .object({
      auditRunId: z.string().uuid(),
      ruleId: z.string().min(1),
      writes: z.literal(false),
    })
    .loose(),
  proposedMutationsJson: z.array(proposedMutationSchema),
  status: z.literal("proposed"),
  schemaVersion: z.literal(RECOMMENDATION_SCHEMA_VERSION),
});

export type RecommendationDraft = z.infer<typeof recommendationDraftSchema>;

export const auditRunSummarySchema = z
  .object({
    writes: z.literal(false),
    mode: z.enum(["empty", "local_tables"]),
    findingCount: z.number().int().nonnegative(),
    recommendationCount: z.number().int().nonnegative(),
    accountIds: z.array(z.string().uuid()),
    ruleIds: z.array(z.string()),
    source: z.literal("os.ad_entities"),
  })
  .loose();

export function parseFindingDraft(input: unknown): FindingDraft {
  return findingDraftSchema.parse(input);
}

export function parseRecommendationDraft(input: unknown): RecommendationDraft {
  return recommendationDraftSchema.parse(input);
}
