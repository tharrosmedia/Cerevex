import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applySafetyOnIds,
  capabilityOnBlockedReason,
  defaultCapabilityFlags,
  isApplySafetyCapability,
  resolveWorkspaceCapabilities,
} from "@cerevex/contracts";
import {
  EXECUTABLE_MUTATION_ACTIONS,
  MUTATION_ACTIONS,
  MUTATION_FAMILIES,
  RECOMMENDATION_TYPES,
  REVERT_WINDOW_MS,
  mutationActionLabel,
  mutationFamilyForAction,
  planRevert,
  proposedMutationSchema,
  revertOwnerMayConfirm,
  type PlanRevertInput,
  type PlannedRevertMutation,
  type RevertActor,
  type RevertPlan,
  type RevertSourceJob,
  type RevertSourceRec,
} from "@tharros/ads-shared";
import { classifyMutation } from "@tharros/ads-shared/mutate";
import { isExecutableMutationAction } from "@tharros/ads-shared/mutations";

const NOW = new Date("2026-10-12T15:00:00.000Z");
const READ_AT = "2026-10-12T14:00:00.000Z";
const OWNER: RevertActor = {
  principal: "user",
  role: "owner",
  email: "adam@tharrosmedia.com",
};

function value(partial: { unit: string; status?: string; amount?: string; currency?: string }): {
  unit: string;
  readAt: string;
  status?: string;
  amount?: string;
  currency?: string;
} {
  return { readAt: READ_AT, ...partial };
}

function pauseOutcome(input: {
  platform: "meta" | "google";
  entityType: string;
  externalId: string;
  name?: string;
  beforeStatus: string;
  afterStatus?: string;
  status?: "applied" | "already_applied" | "failed";
  revertible?: boolean;
  revertBlock?: "no_before_value";
  before?: ReturnType<typeof value> | null;
}) {
  const before =
    input.before === null
      ? undefined
      : input.before ?? value({ status: input.beforeStatus, unit: "status", currency: "USD" });
  const after = value({ status: input.afterStatus ?? "paused", unit: "status", currency: "USD" });
  return {
    action: "pause",
    platform: input.platform,
    target: {
      entityType: input.entityType,
      externalId: input.externalId,
      ...(input.name ? { name: input.name } : {}),
    },
    status: input.status ?? "applied",
    mode: "live" as const,
    writes: input.status === "failed" || input.status === "already_applied" ? false : true,
    ...(before ? { before } : {}),
    after,
    ...(input.revertible === false
      ? { revertible: false as const, revertBlock: input.revertBlock ?? ("no_before_value" as const) }
      : { revertible: true as const }),
  };
}

function moneyOutcome(input: {
  action: "update_budget" | "update_bid";
  platform: "meta" | "google";
  entityType: string;
  externalId: string;
  name?: string;
  beforeAmount: string;
  afterAmount: string;
  unit: string;
  currency?: string | null;
  status?: "applied" | "failed";
  revertible?: boolean;
}) {
  const before = value({
    amount: input.beforeAmount,
    unit: input.unit,
    ...(input.currency ? { currency: input.currency } : {}),
  });
  const after = value({
    amount: input.afterAmount,
    unit: input.unit,
    ...(input.currency ? { currency: input.currency } : {}),
  });
  return {
    action: input.action,
    platform: input.platform,
    target: {
      entityType: input.entityType,
      externalId: input.externalId,
      ...(input.name ? { name: input.name } : {}),
    },
    status: input.status ?? "applied",
    mode: "live" as const,
    writes: input.status === "failed" ? false : true,
    before,
    after,
    revertible: input.revertible ?? true,
  };
}

function rec(overrides: Partial<RevertSourceRec> = {}): RevertSourceRec {
  return {
    id: "rec-1",
    type: "pause_waste",
    evidence: {},
    approval: { rolled_back_at: null },
    proposedMutations: [],
    ...overrides,
  };
}

function job(overrides: Partial<RevertSourceJob> = {}): RevertSourceJob {
  return {
    id: "job-1",
    status: "succeeded",
    finishedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    outcomes: [],
    ...overrides,
  };
}

function flagsOn() {
  return { ...defaultCapabilityFlags(), "apply.revert": "on" as const };
}

function plan(overrides: Partial<PlanRevertInput> = {}): RevertPlan {
  return planRevert({
    rec: rec(),
    applyJob: job(),
    now: NOW,
    actor: OWNER,
    flags: flagsOn(),
    ...overrides,
  });
}

function expectRefusal(result: RevertPlan, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(code);
}

describe("apply.revert flag", () => {
  it("is owner-only apply safety and stays hidden", () => {
    expect(isApplySafetyCapability("apply.revert")).toBe(true);
    expect(defaultCapabilityFlags()["apply.revert"]).toBe("hidden");
    expect(capabilityOnBlockedReason("apply.revert", "on")).toBeNull();
    expect(applySafetyOnIds({ "apply.revert": "on" })).toContain("apply.revert");
    expect(applySafetyOnIds({ "apply.revert": "hidden" })).not.toContain("apply.revert");
  });

  it("stays hidden when the env kill is set, even if settings say on", () => {
    const killed = resolveWorkspaceCapabilities(
      { capabilities: { "apply.revert": "on" } },
      { CAPABILITY_KILL_APPLY_REVERT: "1" },
    );
    expect(killed["apply.revert"]).toBe("hidden");
    const result = plan({
      flags: killed,
      applyJob: job({
        outcomes: [pauseOutcome({ platform: "meta", entityType: "campaign", externalId: "11", beforeStatus: "active" })],
      }),
    });
    expectRefusal(result, "flag_off");
  });
});

describe("resume action and revert type", () => {
  it("adds resume as a non-executable pause-family action and revert as a rec type", () => {
    expect(MUTATION_ACTIONS).toContain("resume");
    expect(RECOMMENDATION_TYPES).toContain("revert");
    expect(EXECUTABLE_MUTATION_ACTIONS).not.toContain("resume");
    expect(isExecutableMutationAction("resume")).toBe(false);
    expect(mutationFamilyForAction("resume")?.id).toBe("pause");
    expect(mutationFamilyForAction("resume")?.capability).toBeNull();
    expect(MUTATION_FAMILIES.pause.actions).toContain("resume");
    expect(mutationActionLabel("resume")).toBe("Turn back on");
  });

  it("does not execute resume when apply.revert is on", () => {
    const skipped = classifyMutation(
      {
        platform: "meta",
        action: "resume",
        target: { entityType: "campaign", externalId: "11", name: "Spring Promo" },
        payload: { status: "active" },
        execute: true,
      },
      flagsOn(),
    );
    expect(skipped).not.toBeNull();
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.writes).toBe(false);
    expect(skipped?.reason).toMatch(/not executable/i);
  });
});

describe("planRevert", () => {
  const metaPause = pauseOutcome({
    platform: "meta",
    entityType: "adset",
    externalId: "11",
    name: "Spring Promo",
    beforeStatus: "active",
  });
  const metaBudget = moneyOutcome({
    action: "update_budget",
    platform: "meta",
    entityType: "adset",
    externalId: "22",
    name: "Core",
    beforeAmount: "5000",
    afterAmount: "6000",
    unit: "minor",
    currency: "USD",
  });
  const googleBid = moneyOutcome({
    action: "update_bid",
    platform: "google",
    entityType: "ad_group",
    externalId: "33",
    name: "Brand",
    beforeAmount: "2100000",
    afterAmount: "2400000",
    unit: "micros",
    currency: "USD",
  });

  it("builds a reverse-order undo from R1 before and after values", () => {
    const result = plan({
      applyJob: job({ outcomes: [metaPause, metaBudget, googleBid] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type).toBe("revert");
    expect(result.confirmable).toBe(true);
    expect(result.previewOnly).toBe(false);
    expect(result.evidence).toEqual({
      revertOf: "rec-1",
      applyJobId: "job-1",
      writes: false,
      outcomes: [
        expect.objectContaining({ action: "pause", before: metaPause.before, after: metaPause.after }),
        expect.objectContaining({ action: "update_budget" }),
        expect.objectContaining({ action: "update_bid" }),
      ],
    });
    expect(result.mutations.map((mutation) => mutation.action)).toEqual([
      "update_bid",
      "update_budget",
      "resume",
    ]);
    const [bid, budget, resume] = result.mutations as [
      PlannedRevertMutation,
      PlannedRevertMutation,
      PlannedRevertMutation,
    ];
    expect(bid).toMatchObject({
      platform: "google",
      action: "update_bid",
      execute: false,
      target: { entityType: "ad_group", externalId: "33", name: "Brand" },
      payload: { amount: "2100000", unit: "micros", currency: "USD", expect: googleBid.after },
    });
    expect(budget.payload).toMatchObject({ amount: "5000", unit: "minor", currency: "USD", expect: metaBudget.after });
    expect(resume).toMatchObject({
      platform: "meta",
      action: "resume",
      execute: false,
      target: { entityType: "adset", externalId: "11", name: "Spring Promo" },
      payload: { status: "active", expect: metaPause.after },
    });
    for (const mutation of result.mutations) {
      expect(proposedMutationSchema.safeParse(mutation).success).toBe(true);
    }
  });

  it("skips a Google campaign pause because resume is not a Google write", () => {
    const google = pauseOutcome({
      platform: "google",
      entityType: "campaign",
      externalId: "99",
      name: "Search",
      beforeStatus: "enabled",
    });
    expectRefusal(plan({ applyJob: job({ outcomes: [google] }) }), "google_pause_not_campaign");
  });

  it("keeps the recorded status casing and reads outcomes from response_json", () => {
    const outcome = pauseOutcome({
      platform: "meta",
      entityType: "campaign",
      externalId: "7",
      beforeStatus: "ACTIVE",
    });
    const result = plan({
      applyJob: job({ outcomes: undefined, responseJson: { outcomes: [outcome] } }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mutations[0]?.payload.status).toBe("ACTIVE");
  });

  it("undoes only applied changes and skips already_applied and failed rows", () => {
    const applied = pauseOutcome({
      platform: "meta",
      entityType: "campaign",
      externalId: "1",
      beforeStatus: "active",
    });
    const already = pauseOutcome({
      platform: "google",
      entityType: "campaign",
      externalId: "2",
      beforeStatus: "paused",
      status: "already_applied",
    });
    const failed = moneyOutcome({
      action: "update_budget",
      platform: "meta",
      entityType: "campaign",
      externalId: "3",
      beforeAmount: "100",
      afterAmount: "200",
      unit: "minor",
      currency: "USD",
      status: "failed",
    });
    const result = plan({ applyJob: job({ outcomes: [applied, already, failed] }) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]?.action).toBe("resume");
    expect(result.mutations[0]?.target.externalId).toBe("1");
  });

  it("lets an operator preview when recommend_only, and still refuses them when the flag is on", () => {
    const operator: RevertActor = { principal: "user", role: "operator", email: "adam@tharrosmedia.com" };
    const preview = plan({
      actor: operator,
      flags: { ...defaultCapabilityFlags(), "apply.revert": "recommend_only" },
      applyJob: job({ outcomes: [metaPause] }),
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.previewOnly).toBe(true);
    expect(preview.confirmable).toBe(false);
    expectRefusal(plan({ actor: operator, applyJob: job({ outcomes: [metaPause] }) }), "not_owner");
    expectRefusal(
      plan({
        actor: { principal: "service", role: "owner", email: "adam@tharrosmedia.com" },
        flags: { ...defaultCapabilityFlags(), "apply.revert": "recommend_only" },
        applyJob: job({ outcomes: [metaPause] }),
      }),
      "not_owner",
    );
  });

  it("is preview-only when apply.revert is recommend_only", () => {
    const result = plan({
      flags: { ...defaultCapabilityFlags(), "apply.revert": "recommend_only" },
      applyJob: job({ outcomes: [metaPause] }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previewOnly).toBe(true);
    expect(result.confirmable).toBe(false);
    expect(result.mutations[0]?.action).toBe("resume");
    expect(result.evidence.writes).toBe(false);
  });

  it("refuses when the flag is hidden or omitted", () => {
    const outcomes = [metaPause];
    expectRefusal(plan({ flags: defaultCapabilityFlags(), applyJob: job({ outcomes }) }), "flag_off");
    expectRefusal(plan({ flags: undefined, applyJob: job({ outcomes }) }), "flag_off");
  });

  it.each([
    ["operator", { principal: "user" as const, role: "operator" as const, email: "adam@tharrosmedia.com" }],
    ["client_readonly", { principal: "user" as const, role: "client_readonly" as const, email: "adam@tharrosmedia.com" }],
    ["service", { principal: "service" as const, role: "owner" as const, email: "adam@tharrosmedia.com" }],
    ["other email", { principal: "user" as const, role: "owner" as const, email: "ops@example.com" }],
    ["missing email", { principal: "user" as const, role: "owner" as const, email: null }],
  ])("refuses confirm by %s", (_label, actor) => {
    expect(revertOwnerMayConfirm(actor)).toBe(false);
    expectRefusal(
      plan({
        actor,
        applyJob: job({ outcomes: [metaPause] }),
      }),
      "not_owner",
    );
  });

  it("allows the allowlisted workspace owner", () => {
    expect(revertOwnerMayConfirm(OWNER)).toBe(true);
  });

  it("refuses a revert of a revert, including when the flag is off", () => {
    const outcomes = [metaPause];
    expectRefusal(plan({ rec: rec({ type: "revert" }), applyJob: job({ outcomes }) }), "is_revert");
    expectRefusal(
      plan({
        flags: defaultCapabilityFlags(),
        rec: rec({ type: "budget_shift", evidence: { revertOf: "rec-0" } }),
        applyJob: job({ outcomes }),
      }),
      "is_revert",
    );
  });

  it("refuses an already undone rec and an undo still in flight", () => {
    const applyJob = job({ outcomes: [metaPause] });
    expectRefusal(
      plan({ rec: rec({ approval: { rolled_back_at: "2026-10-12T14:30:00.000Z" } }), applyJob }),
      "already_undone",
    );
    expectRefusal(plan({ applyJob, undoInFlight: true }), "undo_in_flight");
  });

  it("refuses a job that did not succeed or wrote nothing undoable", () => {
    expectRefusal(plan({ applyJob: job({ status: "failed", outcomes: [metaPause] }) }), "not_applied");
    expectRefusal(plan({ applyJob: job({ status: "applying", outcomes: [metaPause] }) }), "not_applied");
    expectRefusal(
      plan({
        applyJob: job({
          outcomes: [
            pauseOutcome({
              platform: "meta",
              entityType: "campaign",
              externalId: "1",
              beforeStatus: "paused",
              status: "already_applied",
            }),
          ],
        }),
      }),
      "not_applied",
    );
  });

  it("enforces the 7-day window from finished_at", () => {
    const outcomes = [metaPause];
    const edge = plan({
      applyJob: job({ outcomes, finishedAt: new Date(NOW.getTime() - REVERT_WINDOW_MS).toISOString() }),
    });
    expect(edge.ok).toBe(true);
    expectRefusal(
      plan({
        applyJob: job({
          outcomes,
          finishedAt: new Date(NOW.getTime() - REVERT_WINDOW_MS - 1).toISOString(),
        }),
      }),
      "outside_window",
    );
    expectRefusal(plan({ applyJob: job({ outcomes, finishedAt: null }) }), "outside_window");
    expectRefusal(
      plan({ applyJob: job({ outcomes, finishedAt: new Date(NOW.getTime() + 1_000).toISOString() }) }),
      "outside_window",
    );
  });

  it.each([
    ["contains_create", { action: "create_ad" }],
    ["contains_create", { action: "add_keyword" }],
    ["contains_negative", { action: "add_negative" }],
    ["contains_placement", { action: "exclude_placement" }],
    ["contains_geo", { action: "tighten_geo" }],
  ] as const)("refuses a rec that contains %s via %s", (code, mutation) => {
    const result = plan({
      rec: rec({
        proposedMutations: [
          {
            platform: "meta",
            action: mutation.action,
            target: { entityType: "campaign", externalId: "1" },
            payload: {},
            execute: false,
          },
        ],
      }),
      applyJob: job({ outcomes: [metaPause] }),
    });
    expectRefusal(result, code);
    if (!result.ok) expect(result).not.toHaveProperty("mutations");
  });

  it("refuses the whole undo when any applied change has no before-value", () => {
    const broken = pauseOutcome({
      platform: "meta",
      entityType: "campaign",
      externalId: "5",
      beforeStatus: "enabled",
      revertible: false,
      before: null,
    });
    const result = plan({ applyJob: job({ outcomes: [metaPause, broken] }) });
    expectRefusal(result, "no_before_value");
  });

  it("refuses a money undo whose before amount or currency cannot be written back", () => {
    expectRefusal(
      plan({
        applyJob: job({
          outcomes: [
            moneyOutcome({
              action: "update_budget",
              platform: "meta",
              entityType: "adset",
              externalId: "8",
              beforeAmount: "12.5",
              afterAmount: "20",
              unit: "minor",
              currency: "USD",
            }),
          ],
        }),
      }),
      "no_before_value",
    );
    expectRefusal(
      plan({
        applyJob: job({
          outcomes: [
            moneyOutcome({
              action: "update_bid",
              platform: "google",
              entityType: "ad_group",
              externalId: "9",
              beforeAmount: "1000000",
              afterAmount: "2000000",
              unit: "micros",
              currency: "JPY",
            }),
          ],
        }),
      }),
      "non_decimal_currency",
    );
    expectRefusal(
      plan({
        applyJob: job({
          outcomes: [
            moneyOutcome({
              action: "update_budget",
              platform: "meta",
              entityType: "campaign",
              externalId: "10",
              beforeAmount: "5000",
              afterAmount: "6000",
              unit: "minor",
              currency: null,
            }),
          ],
        }),
      }),
      "non_decimal_currency",
    );
  });

  it("skips every Google pause until resume exists", () => {
    for (const entityType of ["campaign", "ad_group", "ad", "AD_GROUP"]) {
      expectRefusal(
        plan({
          applyJob: job({
            outcomes: [
              pauseOutcome({
                platform: "google",
                entityType,
                externalId: "4",
                beforeStatus: "enabled",
              }),
            ],
          }),
        }),
        "google_pause_not_campaign",
      );
    }
  });

  it("refuses an applied resume as a redo", () => {
    expectRefusal(
      plan({
        applyJob: job({
          outcomes: [
            {
              action: "resume",
              platform: "meta",
              target: { entityType: "campaign", externalId: "1" },
              status: "applied",
              before: value({ status: "paused", unit: "status" }),
              after: value({ status: "active", unit: "status" }),
              revertible: true,
            },
          ],
        }),
      }),
      "is_revert",
    );
  });
});

describe("audits, skills, and m51/m52 engines", () => {
  it("does not emit resume or a revert rec", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const root = resolve(here, "../../../..");
    const files = [
      "apps/ads/shared/src/audit-engine.ts",
      "apps/ads/shared/src/audit.ts",
      "apps/ads/shared/src/m51-engine.ts",
      "apps/ads/shared/src/operator-hygiene.ts",
      "apps/ads/shared/src/seasonality-calendar.ts",
      "apps/ads/shared/src/owner-weekly-narrative.ts",
      "apps/ads/shared/src/lead-lifecycle.ts",
      "apps/ads/shared/src/lp-intelligence.ts",
      "apps/ads/shared/src/grok-creatives.ts",
      "apps/ads/shared/src/creative-analysis.ts",
      ...walkTs(resolve(root, "packages/skills/src")),
    ];
    const banned = /["']resume["']|["']revert["']/;
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(resolve(root, file), "utf8");
      if (banned.test(text)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "vendor") continue;
      out.push(...walkTs(path));
      continue;
    }
    if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}
