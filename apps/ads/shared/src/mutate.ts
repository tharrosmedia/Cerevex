import { and, eq } from "drizzle-orm";
import type { CapabilityFlags } from "@cerevex/contracts";
import { resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { getAdPlatformConnector, getDefaultSiteConnector } from "./connectors";
import { siteApplyBlockedReason } from "./lp-intelligence";
import { loadTokens } from "./credentials";
import { getDb } from "./db";
import { isBookedJobSignalWritable, isBudgetShiftWritable, isCapabilityOn } from "@cerevex/contracts";
import { crmWriteBlockedReason } from "./lead-lifecycle";
import { isMutationFamilyEnabled, mutationFamilyForAction, mutationFamilySkipReason } from "./mutation-families";
import { isCreateNewMutationAction, isExecutableMutationAction } from "./mutations";
import type { LiveEntityState, MutationOutcome } from "./mutate-types";
import { adAccounts, adEntities } from "./schema";
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

  if (mutation.action === "create_ad") {
    const account = await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, adAccountId) });
    if (!account && !entity) {
      return {
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "failed",
        mode: "mock",
        writes: false,
        reason: "Ad account missing for mock create.",
      };
    }
    const proposedName =
      typeof mutation.payload.proposedName === "string"
        ? mutation.payload.proposedName
        : `${mutation.target.name ?? "Ad"} — variant`;
    const [created] = await db
      .insert(adEntities)
      .values({
        workspaceId: entity?.workspaceId ?? account!.workspaceId,
        clientId: entity?.clientId ?? account!.clientId,
        adAccountId,
        platform: mutation.platform,
        entityType: "ad",
        externalId: `mock-${mutation.platform}-${Date.now()}`,
        name: proposedName,
        status: "active",
        parentExternalId: mutation.target.externalId,
        rawJson: {
          source: "m51-create-mock",
          headline: mutation.payload.headline ?? null,
          body: mutation.payload.body ?? null,
          offer: mutation.payload.offer ?? null,
          imageUrl: mutation.payload.imageUrl ?? null,
          lastMutation: "create_ad",
        },
      })
      .returning()
      .catch(() => []);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: created
        ? { entityType: "ad", externalId: created.externalId, name: created.name }
        : mutation.target,
      status: "applied",
      mode: "mock",
      writes: true,
      reason: "Mock create recorded a local ad. No live platform call.",
    };
  }

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

/** M5.1 budget-shift writes — not generic M5 high-CPA `update_budget`. */
export function isM51BudgetShiftMutation(mutation: ApplyMutation): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "booked_job") return false;
  if (payload.m51 === "budget_shift") return true;
  const reason = payload.reason;
  return mutation.action === "update_budget" && typeof reason === "string" && reason.startsWith("shift_");
}

/** M5.2 booked-job ads signal writes — not generic or M5.1 budget shift. */
export function isM52BookedJobMutation(mutation: ApplyMutation): boolean {
  const payload = mutation.payload ?? {};
  if (payload.m52 === "booked_job") return true;
  const reason = payload.reason;
  return mutation.action === "update_budget" && typeof reason === "string" && reason.startsWith("booked_job_");
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
  if (isM51BudgetShiftMutation(mutation) && !isBudgetShiftWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Budget shift is recommend-only or off (m51.budget_shift). No platform write.",
    };
  }
  if (isM52BookedJobMutation(mutation) && !isBookedJobSignalWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Booked-job signal is recommend-only or off (m52.booked_job_signal). No platform write.",
    };
  }
  if (mutation.action === "review") {
    const payloadAction = typeof mutation.payload?.action === "string" ? mutation.payload.action : null;
    const siteBlocked = siteApplyBlockedReason(getDefaultSiteConnector(), payloadAction);
    const crmBlocked = crmWriteBlockedReason(payloadAction === "crm_write_later" ? "lead_lifecycle" : payloadAction);
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: crmBlocked
        ? "Lead lifecycle is recommend-only. CRM apply later — nothing writes Housecall Pro."
        : siteBlocked
          ? "LP intelligence is recommend-only. Site apply later — nothing writes the website."
        : "Review-only mutation. No platform write.",
    };
  }
  if (isCreateNewMutationAction(mutation.action)) {
    if (!isCapabilityOn("apply.create_entity", flags)) {
      return {
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "skipped",
        mode: "mock",
        writes: false,
        reason: "Create-entity is off (apply.create_entity). Skipped — not applied.",
      };
    }
    return null;
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
