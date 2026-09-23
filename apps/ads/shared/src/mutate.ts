import { and, eq } from "drizzle-orm";
import type { CapabilityFlags } from "@shopify-brain/contracts";
import { resolveWorkspaceCapabilities } from "@shopify-brain/contracts";
import { getAdPlatformConnector } from "./connectors";
import { loadTokens } from "./credentials";
import { getDb } from "./db";
import { isMutationFamilyEnabled, mutationFamilyForAction, mutationFamilySkipReason } from "./mutation-families";
import { isCreateNewMutationAction, isExecutableMutationAction } from "./mutations";
import type { LiveEntityState, MutationOutcome } from "./mutate-types";
import { adEntities } from "./schema";
import type { ApplyMutation } from "./audit-schemas";
import type { Platform, StoredOAuthTokens } from "./types";

export type { LiveEntityState, MutationOutcome } from "./mutate-types";

async function applyMockMutation(
  adAccountId: string,
  mutation: ApplyMutation,
): Promise<MutationOutcome> {
  const db = getDb();
  const entity = await db.query.adEntities.findFirst({
    where: and(
      eq(adEntities.adAccountId, adAccountId),
      eq(adEntities.externalId, mutation.target.externalId),
    ),
  });

  if (mutation.action === "pause") {
    if (entity && ["paused", "paused"].includes(entity.status.toLowerCase())) {
      return {
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "already_applied",
        mode: "mock",
        writes: false,
        reason: "Already paused in local tables.",
      };
    }
    if (entity) {
      await db
        .update(adEntities)
        .set({
          status: "paused",
          rawJson: { ...(entity.rawJson as Record<string, unknown>), lastMutation: "pause", source: "m5-apply-mock" },
        })
        .where(eq(adEntities.id, entity.id));
    }
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "applied",
      mode: "mock",
      writes: true,
      reason: "Mock apply updated local entity status. No live platform call.",
    };
  }

  if (entity) {
    await db
      .update(adEntities)
      .set({
        rawJson: {
          ...(entity.rawJson as Record<string, unknown>),
          lastMutation: mutation.action,
          lastPayload: mutation.payload,
          source: "m5-apply-mock",
        },
      })
      .where(eq(adEntities.id, entity.id));
  }

  return {
    action: mutation.action,
    platform: mutation.platform,
    target: mutation.target,
    status: "applied",
    mode: "mock",
    writes: true,
    reason: `Mock apply recorded ${mutation.action}. No live platform call.`,
  };
}

export async function readLiveEntityState(input: {
  platform: Platform;
  tokens: StoredOAuthTokens;
  mutation: ApplyMutation;
}): Promise<LiveEntityState | null> {
  return getAdPlatformConnector(input.platform).readLiveEntityState({
    tokens: input.tokens,
    mutation: input.mutation,
  });
}

/** Live apply/read always goes through the AdPlatform connector registry. */
export async function applyViaConnector(input: {
  platform: Platform;
  tokens: StoredOAuthTokens;
  mutation: ApplyMutation;
  accountExternalId: string;
}): Promise<MutationOutcome> {
  const connector = getAdPlatformConnector(input.platform);
  const live = await connector
    .readLiveEntityState({ tokens: input.tokens, mutation: input.mutation })
    .catch(() => null);
  return connector.applyLive({
    tokens: input.tokens,
    mutation: input.mutation,
    live,
    accountExternalId: input.accountExternalId,
  });
}

export function classifyMutation(
  mutation: ApplyMutation,
  flags: CapabilityFlags = resolveWorkspaceCapabilities({}),
): MutationOutcome | null {
  if (isCreateNewMutationAction(mutation.action) || mutation.action === "review") {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason:
        mutation.action === "review"
          ? "Review-only mutation. No platform write."
          : "Create-new entity path is out of M5 scope. Skipped — not applied.",
    };
  }
  if (!isExecutableMutationAction(mutation.action)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: `Mutation class ${mutation.action} is not executable under Approve.`,
    };
  }
  const family = mutationFamilyForAction(mutation.action);
  if (family && !isMutationFamilyEnabled(family, flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: mutationFamilySkipReason(family),
    };
  }
  return null;
}

export async function executeMutation(input: {
  adAccountId: string;
  platform: Platform;
  accountExternalId: string;
  mutation: ApplyMutation;
  capabilities?: CapabilityFlags;
}): Promise<MutationOutcome> {
  const skipped = classifyMutation(input.mutation, input.capabilities ?? resolveWorkspaceCapabilities({}));
  if (skipped) return skipped;

  const tokens = await loadTokens(input.adAccountId);
  if (!tokens) {
    return {
      action: input.mutation.action,
      platform: input.platform,
      target: input.mutation.target,
      status: "failed",
      mode: "mock",
      writes: false,
      reason: "No OAuth credentials for this ad account.",
    };
  }

  const connector = getAdPlatformConnector(input.platform);
  if (!connector.isLiveAllowed(tokens, input.capabilities ?? resolveWorkspaceCapabilities({}))) {
    return applyMockMutation(input.adAccountId, input.mutation);
  }

  return applyViaConnector({
    platform: input.platform,
    tokens,
    mutation: input.mutation,
    accountExternalId: input.accountExternalId,
  });
}
