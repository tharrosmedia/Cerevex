import { and, eq } from "drizzle-orm";
import type { CapabilityFlags } from "@cerevex/contracts";
import { resolveWorkspaceCapabilities } from "@cerevex/contracts";
import { getAdPlatformConnector, getDefaultSiteConnector } from "./connectors";
import { attachMetaLiveCurrency } from "./connectors/meta";
import { ApplyCallBudgetError, platformCallBudgetMs } from "./connectors/write-timeout";
import { siteApplyBlockedReason } from "./lp-intelligence";
import { loadTokens } from "./credentials";
import { isMetaPermissionMissing, isMetaRateLimited, isMetaTokenExpired, scrubMetaSecrets } from "./meta-graph-error";
import { ensureFreshPlatformTokens, metaMutationFailure } from "./meta-token";
import { getDb } from "./db";
import {
  isBookedJobSignalWritable,
  isBrandGuardrailsVisible,
  isBrandGuardrailsWritable,
  isBudgetShiftWritable,
  isCapabilityOn,
  isGeoDisciplineWritable,
  isOwnerWeeklyNarrativeWritable,
  isSearchNegativesWritable,
  isSeasonalityCalendarWritable,
} from "@cerevex/contracts";
import { crmWriteBlockedReason } from "./lead-lifecycle";
import {
  brandGuardrailSpendBlockedReason,
  claimHitsForEntity,
  isM52BrandGuardrailMutation,
  isM52GeoDisciplineMutation,
  isM52SearchNegativeMutation,
} from "./operator-hygiene";
import { isM52WeeklyNarrativeMutation } from "./owner-weekly-narrative";
import { isM52SeasonalityMutation } from "./seasonality-calendar";
import { platformSyncLiveEnabled } from "./flags";
import { metaLiveWriteBlock, applyBlockMessage } from "./apply-gate";
import { isMockToken, realTokenLiveBlock } from "./live-or-loud";
import { metaLiveConfirmRefusal, metaWriteInputRefusal } from "./meta-write-safety";
import { isMutationFamilyEnabled, mutationFamilyForAction, mutationFamilySkipReason } from "./mutation-families";
import { isCreateNewMutationAction, isExecutableMutationAction } from "./mutations";
import {
  OUTCOME_UNIT,
  outcomeValue,
  stampNoBefore,
  type LiveEntityState,
  type MutationOutcome,
  type OutcomeValue,
} from "./mutate-types";
import { adAccounts, adEntities } from "./schema";
import type { ApplyMutation } from "./audit-schemas";
import type { Platform, StoredOAuthTokens } from "./types";

export type { LiveEntityState, MutationOutcome, OutcomeValue } from "./mutate-types";

function mockValue(partial: { status?: string; amount?: string }, readAt = new Date().toISOString()): OutcomeValue {
  return outcomeValue({ ...partial, unit: OUTCOME_UNIT.mock, readAt });
}

function mockMoney(raw: Record<string, unknown>, action: string, payload: Record<string, unknown>): {
  before: OutcomeValue;
  after: OutcomeValue;
} {
  const current = action === "update_bid" ? raw.bidAmount : (raw.dailyBudget ?? raw.budget);
  const beforeAmount = current == null || current === "" ? "0" : String(current);
  const payloadAmount = payload.amount;
  const afterAmount =
    typeof payloadAmount === "number" || typeof payloadAmount === "string" ? String(payloadAmount) : beforeAmount;
  const readAt = new Date().toISOString();
  return {
    before: mockValue({ amount: beforeAmount }, readAt),
    after: mockValue({ amount: afterAmount }, readAt),
  };
}

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
      const paused = mockValue({ status: "paused" });
      return {
        action: mutation.action,
        platform: mutation.platform,
        target: mutation.target,
        status: "already_applied",
        mode: "mock",
        writes: false,
        reason: "Already paused in local tables.",
        before: paused,
        after: paused,
        revertible: true,
      };
    }
    const beforeStatus = entity?.status ?? "active";
    if (entity) {
      await db
        .update(adEntities)
        .set({
          status: "paused",
          rawJson: { ...(entity.rawJson as Record<string, unknown>), lastMutation: "pause", source: "m5-apply-mock" },
        })
        .where(eq(adEntities.id, entity.id));
    }
    const readAt = new Date().toISOString();
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "applied",
      mode: "mock",
      writes: true,
      reason: "Mock apply updated local entity status. No live platform call.",
      before: mockValue({ status: beforeStatus }, readAt),
      after: mockValue({ status: "paused" }, readAt),
      revertible: true,
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

  const money =
    mutation.action === "update_budget" || mutation.action === "update_bid"
      ? mockMoney((entity?.rawJson as Record<string, unknown> | null) ?? {}, mutation.action, mutation.payload ?? {})
      : null;
  return {
    action: mutation.action,
    platform: mutation.platform,
    target: mutation.target,
    status: "applied",
    mode: "mock",
    writes: true,
    reason: `Mock apply recorded ${mutation.action}. No live platform call.`,
    ...(money ? { ...money, revertible: true as const } : {}),
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
  if (payload.m52 === "seasonality_calendar") return false;
  if (payload.m52 === "owner_weekly_narrative") return false;
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

async function brandSpendGuardOutcome(
  adAccountId: string,
  mutation: ApplyMutation,
  flags: CapabilityFlags,
): Promise<MutationOutcome | null> {
  if (!isBrandGuardrailsVisible(flags)) return null;
  const db = getDb();
  const rows = await db.query.adEntities.findMany({
    where: eq(adEntities.adAccountId, adAccountId),
  });
  const target = rows.find((row) => row.externalId === mutation.target.externalId);
  const related = rows.filter((row) => {
    if (row.externalId === mutation.target.externalId) return true;
    if (!target) return false;
    return row.parentExternalId === target.externalId || target.parentExternalId === row.externalId;
  });
  const pool = related.length > 0 ? related : target ? [target] : [];
  const hits = pool.flatMap((row) =>
    claimHitsForEntity({
      entityType: row.entityType,
      externalId: row.externalId,
      name: row.name,
      status: row.status,
      parentExternalId: row.parentExternalId,
      raw: (row.rawJson as Record<string, unknown>) ?? {},
    }),
  );
  const blocked = brandGuardrailSpendBlockedReason(true, mutation, hits);
  if (!blocked) return null;
  return {
    action: mutation.action,
    platform: mutation.platform,
    target: mutation.target,
    status: "skipped",
    mode: "mock",
    writes: false,
    reason: "Brand guardrail blocked this spend change. Unsupervised spend is not allowed past a claim risk.",
  };
}

/** Live apply/read always goes through the AdPlatform connector registry. */
export async function applyViaConnector(input: {
  platform: Platform;
  tokens: StoredOAuthTokens;
  mutation: ApplyMutation;
  accountExternalId: string;
  deadlineAt?: number;
}): Promise<MutationOutcome> {
  const connector = getAdPlatformConnector(input.platform);
  if (input.platform === "meta") {
    const inputRefusal = metaWriteInputRefusal(input.mutation);
    if (inputRefusal) return inputRefusal;
  }
  const live = await connector
    .readLiveEntityState({ tokens: input.tokens, mutation: input.mutation, deadlineAt: input.deadlineAt })
    .catch((error: unknown) => {
      if (error instanceof ApplyCallBudgetError) throw error;
      if (isMetaTokenExpired(error) || isMetaRateLimited(error) || isMetaPermissionMissing(error)) throw error;
      if (input.deadlineAt != null && platformCallBudgetMs(input.deadlineAt) <= 0) throw new ApplyCallBudgetError();
      return null;
    });
  if (input.deadlineAt != null && platformCallBudgetMs(input.deadlineAt) <= 0) throw new ApplyCallBudgetError();
  if (input.platform === "meta") {
    const confirmed = metaLiveConfirmRefusal({
      mutation: input.mutation,
      live,
      accountExternalId: input.accountExternalId,
    });
    if (confirmed) return live ? confirmed : stampNoBefore(confirmed);
  }
  let liveForWrite = live;
  // readAt marks a real connector read. A caller-supplied live state does not fetch currency.
  if (input.platform === "meta" && liveForWrite?.readAt && !liveForWrite.currency) {
    liveForWrite = await attachMetaLiveCurrency(liveForWrite, {
      accessToken: input.tokens.accessToken,
      accountExternalId: input.accountExternalId,
      deadlineAt: input.deadlineAt,
    });
  }
  const outcome = await connector.applyLive({
    tokens: input.tokens,
    mutation: input.mutation,
    live: liveForWrite,
    accountExternalId: input.accountExternalId,
    deadlineAt: input.deadlineAt,
  });
  return live ? outcome : stampNoBefore(outcome);
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
  if (isM52SearchNegativeMutation(mutation) && !isSearchNegativesWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Search-term hygiene is recommend-only or off (m52.search_negatives). No platform write.",
    };
  }
  if (isM52GeoDisciplineMutation(mutation) && !isGeoDisciplineWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Geo / service-area is recommend-only or off (m52.geo_discipline). No platform write.",
    };
  }
  if (isM52BrandGuardrailMutation(mutation) && !isBrandGuardrailsWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Brand guardrails are recommend-only or off (m52.brand_guardrails). No platform write.",
    };
  }
  if (isM52SeasonalityMutation(mutation) && !isSeasonalityCalendarWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Seasonality calendar is recommend-only or off (m52.seasonality_calendar). No platform write.",
    };
  }
  if (isM52WeeklyNarrativeMutation(mutation) && !isOwnerWeeklyNarrativeWritable(flags)) {
    return {
      action: mutation.action,
      platform: mutation.platform,
      target: mutation.target,
      status: "skipped",
      mode: "mock",
      writes: false,
      reason: "Owner weekly narrative is recommend-only or off (m52.owner_weekly_narrative). No platform write.",
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

async function scrubStoredOutcome(adAccountId: string, outcome: MutationOutcome): Promise<MutationOutcome> {
  let secrets: string[] = [];
  try {
    const tokens = await loadTokens(adAccountId);
    secrets = [tokens?.accessToken, tokens?.refreshToken].filter(
      (value): value is string => typeof value === "string" && value.length >= 8,
    );
  } catch {
    return outcome;
  }
  if (secrets.length === 0) return outcome;
  const variants = [...new Set(secrets.flatMap((secret) => [secret, secret.toLowerCase(), secret.toUpperCase()]))];
  const cleaned = scrubMetaSecrets(JSON.stringify(outcome), variants);
  try {
    return JSON.parse(cleaned) as MutationOutcome;
  } catch {
    return outcome;
  }
}

export async function executeMutation(input: {
  adAccountId: string;
  platform: Platform;
  accountExternalId: string;
  mutation: ApplyMutation;
  capabilities?: CapabilityFlags;
  deadlineAt?: number;
}): Promise<MutationOutcome> {
  return scrubStoredOutcome(input.adAccountId, await runExecuteMutation(input));
}

async function runExecuteMutation(input: {
  adAccountId: string;
  platform: Platform;
  accountExternalId: string;
  mutation: ApplyMutation;
  capabilities?: CapabilityFlags;
  deadlineAt?: number;
}): Promise<MutationOutcome> {
  const flags = input.capabilities ?? resolveWorkspaceCapabilities({});
  const skipped = classifyMutation(input.mutation, flags);
  if (skipped) return skipped;

  const brandSpend = await brandSpendGuardOutcome(input.adAccountId, input.mutation, flags);
  if (brandSpend) return brandSpend;

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
  if (isMockToken(tokens)) {
    return applyMockMutation(input.adAccountId, input.mutation);
  }
  const metaBlock = metaLiveWriteBlock({
    platform: input.platform,
    mock: false,
    capabilities: flags,
  });
  if (metaBlock) {
    return {
      action: input.mutation.action,
      platform: input.platform,
      target: input.mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: applyBlockMessage(metaBlock),
    };
  }
  const block = realTokenLiveBlock({
    platform: input.platform,
    mock: tokens.mock,
    configured: connector.isConfigured(),
    syncLive: platformSyncLiveEnabled(flags),
  });
  if (block?.kind === "not_configured") {
    return {
      action: input.mutation.action,
      platform: input.platform,
      target: input.mutation.target,
      status: "failed",
      mode: "live",
      writes: false,
      reason: block.applyReason,
    };
  }
  if (block) {
    return {
      action: input.mutation.action,
      platform: input.platform,
      target: input.mutation.target,
      status: "skipped",
      mode: "live",
      writes: false,
      reason: block.applyReason,
    };
  }

  let fresh = tokens;
  try {
    fresh = await ensureFreshPlatformTokens({ adAccountId: input.adAccountId, tokens });
  } catch (error) {
    const failed = await metaMutationFailure(input.adAccountId, input.mutation, error);
    if (failed) return failed;
    throw error;
  }

  try {
    return await applyViaConnector({
      platform: input.platform,
      tokens: fresh,
      mutation: input.mutation,
      accountExternalId: input.accountExternalId,
      deadlineAt: input.deadlineAt,
    });
  } catch (error) {
    const failed = await metaMutationFailure(input.adAccountId, input.mutation, error);
    if (failed) return failed;
    throw error;
  }
}
