import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateAccount } from "@tharros/ads-shared/audit-engine";
import { recommendationDraftSchema } from "@tharros/ads-shared/audit-schemas";
import {
  bookedJobSignalWriteBlockedReason,
  crmWriteBlockedReason,
  defaultCapabilityFlags,
  mockHcpBookedJobs,
  mockHcpLeads,
  recsFromBookedJobSignal,
  recsFromLeadLifecycle,
  summarizeLeadLifecycle,
} from "@tharros/ads-shared";
import { classifyMutation, isM51BudgetShiftMutation, isM52BookedJobMutation } from "@tharros/ads-shared/mutate";
import {
  housecallProConnector,
  jobsFromHcpBody,
  leadsFromHcpBody,
} from "@tharros/ads-shared/connectors";
import { readConnectorSettings } from "@tharros/ads-shared/connector-settings";
import { filterOfflineRecommendations } from "../src/offline";

function accountInput(extra: Record<string, unknown> = {}) {
  return {
    workspaceId: randomUUID(),
    clientId: randomUUID(),
    auditRunId: randomUUID(),
    adAccountId: randomUUID(),
    platform: "google" as const,
    entities: [
      {
        entityType: "campaign",
        externalId: "camp-1",
        name: "Got Ductless — Google HVAC leads",
        status: "active",
      },
      {
        entityType: "campaign",
        externalId: "camp-2",
        name: "Got Ductless — Meta HVAC leads",
        status: "active",
      },
    ],
    metrics: [
      {
        entityExternalId: "camp-1",
        entityType: "campaign",
        window: "30d",
        spendUsd: "80.00",
        impressions: 1200,
        clicks: 40,
        conversions: "3",
      },
      {
        entityExternalId: "camp-2",
        entityType: "campaign",
        window: "30d",
        spendUsd: "140.00",
        impressions: 1800,
        clicks: 50,
        conversions: "1",
      },
    ],
    ...extra,
  };
}

describe("M5.2 Phase D CRM / HCP booked-job loop", () => {
  it("mock-connects and pulls the lead → contacted → booked path without writing HCP", async () => {
    const connected = await housecallProConnector.connect({
      workspaceId: "ws",
      clientId: "c",
      mock: true,
    });
    expect(connected.ok).toBe(true);
    expect(connected.stub).toBe(false);
    expect(connected.mock).toBe(true);
    expect(housecallProConnector.writes).toBe(false);

    const pulled = await housecallProConnector.pullLeadsAndJobs({
      workspaceId: "ws",
      clientId: "c",
      clientName: "Got Ductless",
      mock: true,
    });
    expect(pulled.ok).toBe(true);
    expect(pulled.writes).toBe(false);
    expect(pulled.bookedJobs.some((job) => job.status === "booked")).toBe(true);
    expect(pulled.leads.map((lead) => lead.stage).sort()).toEqual(["booked", "contacted", "lead"]);
    expect(pulled.reason).toMatch(/write-backs stay out/i);
  });

  it("refuses live connect without a key and never writes", async () => {
    const missing = await housecallProConnector.connect({
      workspaceId: "ws",
      clientId: "c",
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/api key|mock connect/i);

    const pulled = await housecallProConnector.pullLeadsAndJobs({
      workspaceId: "ws",
      clientId: "c",
      clientName: "Got Ductless",
      mock: false,
    });
    expect(pulled.ok).toBe(false);
    expect(pulled.writes).toBe(false);
    expect(pulled.bookedJobs).toEqual([]);
    expect(pulled.leads).toEqual([]);
  });

  it("maps Housecall Pro jobs to booked jobs and lifecycle without PII dumps", () => {
    const jobs = jobsFromHcpBody(
      {
        jobs: [
          {
            id: "job-1",
            work_status: "scheduled",
            description: "Ductless install",
            created_at: "2026-09-23T00:00:00.000Z",
            customer: { mobile_number: "555-010-1201" },
            original_lead_source: "HVAC leads",
          },
        ],
      },
      "Got Ductless",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("booked");
    expect(jobs[0]?.customerPhoneLast4).toBe("1201");
    const leads = leadsFromHcpBody({}, jobs, "Got Ductless");
    expect(leads[0]?.stage).toBe("booked");
    expect(JSON.stringify(leads)).not.toMatch(/555-010-1201/);
  });

  it("summarizes the common path in plain language", () => {
    const summary = summarizeLeadLifecycle(mockHcpLeads("Got Ductless"));
    expect(summary.leadCount).toBe(1);
    expect(summary.contactedCount).toBe(1);
    expect(summary.bookedCount).toBe(1);
    expect(summary.writes).toBe(false);
    expect(summary.cards.map((card) => card.stage)).toEqual(["lead", "contacted", "booked"]);
    expect(summary.sentences.join(" ")).toMatch(/common path/i);
    expect(summary.sentences.join(" ")).not.toMatch(/roas|cpa|cpc/i);
  });

  it("emits recommend-only lead_lifecycle recs when the flag is on", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          leadLifecycleEnabled: true,
          leads: mockHcpLeads("Got Ductless"),
        },
      }),
    );
    const recs = result.recommendations.filter((row) => row.type === "lead_lifecycle");
    expect(recs).toHaveLength(1);
    expect(recommendationDraftSchema.safeParse(recs[0]).success).toBe(true);
    expect(recs[0]?.evidenceJson.writes).toBe(false);
    expect(recs[0]?.evidenceJson.crmWrite).toBe("later");
    expect(recs[0]?.proposedMutationsJson.every((row) => row.action === "review")).toBe(true);
    expect(recs[0]?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);
    expect(crmWriteBlockedReason("lead_lifecycle")).toBe("crm_write_later");
    expect(crmWriteBlockedReason("booked_job")).toBeNull();
  });

  it("does not emit lifecycle recs when the capability is off", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          leadLifecycleEnabled: false,
          leads: mockHcpLeads("Got Ductless"),
        },
      }),
    );
    expect(result.recommendations.some((row) => row.type === "lead_lifecycle")).toBe(false);
  });

  it("emits booked_job optimize recs that can propose a budget shift", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          bookedJobSignalEnabled: true,
          bookedJobs: mockHcpBookedJobs("Got Ductless"),
        },
      }),
    );
    const recs = result.recommendations.filter((row) => row.type === "booked_job");
    expect(recs).toHaveLength(1);
    expect(recommendationDraftSchema.safeParse(recs[0]).success).toBe(true);
    expect(recs[0]?.evidenceJson.writes).toBe(false);
    expect(recs[0]?.proposedMutationsJson.some((row) => row.action === "update_budget")).toBe(true);
    expect(recs[0]?.proposedMutationsJson.every((row) => row.execute === false)).toBe(true);
    expect(recs[0]?.proposedMutationsJson.every((row) => row.payload?.m52 === "booked_job")).toBe(true);
    expect(isM51BudgetShiftMutation(recs[0]!.proposedMutationsJson[0]!)).toBe(false);
    expect(isM52BookedJobMutation(recs[0]!.proposedMutationsJson[0]!)).toBe(true);
  });

  it("does not emit booked_job recs when the signal flag is off", () => {
    const result = evaluateAccount(
      accountInput({
        offlineSignals: {
          bookedJobSignalEnabled: false,
          bookedJobs: mockHcpBookedJobs("Got Ductless"),
        },
      }),
    );
    expect(result.recommendations.some((row) => row.type === "booked_job")).toBe(false);
  });

  it("hides lifecycle and booked-job recs when flags are hidden", () => {
    const flags = defaultCapabilityFlags();
    const rows = [
      { type: "pause_waste" },
      { type: "lead_lifecycle" },
      { type: "booked_job" },
      { type: "crm_booked_job" },
    ];
    expect(filterOfflineRecommendations(rows, flags).map((row) => row.type)).toEqual(["pause_waste"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.lead_lifecycle": "recommend_only" }).map((row) => row.type),
    ).toEqual(["pause_waste", "lead_lifecycle"]);
    expect(
      filterOfflineRecommendations(rows, { ...flags, "m52.booked_job_signal": "on" }).map((row) => row.type),
    ).toEqual(["pause_waste", "booked_job"]);
  });

  it("blocks booked-job ads writes unless the signal flag is on", () => {
    const hidden = defaultCapabilityFlags();
    const recommendOnly = { ...hidden, "m52.booked_job_signal": "recommend_only" as const };
    const on = { ...hidden, "m52.booked_job_signal": "on" as const };
    expect(bookedJobSignalWriteBlockedReason(recommendOnly, "booked_job")).toBe(
      "capability_m52_booked_job_signal_recommend_only",
    );
    expect(bookedJobSignalWriteBlockedReason(on, "booked_job")).toBeNull();
    const mutation = {
      platform: "google" as const,
      action: "update_budget" as const,
      target: { entityType: "campaign", externalId: "camp-1", name: "HVAC" },
      payload: { percent: 10, m52: "booked_job", reason: "booked_job_toward_winner" },
    };
    const blocked = classifyMutation(mutation, recommendOnly);
    expect(blocked?.writes).toBe(false);
    expect(blocked?.status).toBe("skipped");
    expect(classifyMutation(mutation, on)).toBeNull();
  });

  it("keeps CRM snapshots in settings_json without an ALTER", () => {
    const loaded = readConnectorSettings({
      connectors: {
        crm: {
          "11111111-1111-1111-1111-111111111111": {
            connected: true,
            mock: true,
            provider: "hcp",
            bookedJobs: mockHcpBookedJobs("Pilot"),
            leads: mockHcpLeads("Pilot"),
          },
        },
      },
    });
    expect(loaded.crm["11111111-1111-1111-1111-111111111111"]?.bookedJobs.length).toBeGreaterThan(0);
    expect(loaded.crm["11111111-1111-1111-1111-111111111111"]?.leads?.length).toBe(3);
  });

  it("builds booked-job signal drafts without claiming a write", () => {
    const drafts = recsFromBookedJobSignal({
      bookedJobs: mockHcpBookedJobs("Got Ductless"),
      bookedJoinCount: 1,
      campaignName: "Google HVAC leads",
      canProposeBudget: true,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.rationale).toMatch(/approve/i);
    expect(recsFromLeadLifecycle(mockHcpLeads("Got Ductless"))[0]?.crmWrite).toBe("later");
  });
});
