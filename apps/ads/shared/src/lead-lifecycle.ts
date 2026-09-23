/**
 * M5.2 Phase D — lead lifecycle + booked-job ads signal.
 * Common path lead → contacted → booked stays inside Cerevex.
 * CRM writes stay Approve-gated. Unsupervised connect/pull never write HCP.
 */

import type { BookedJob } from "./attribution";

export const LEAD_STAGES = ["lead", "contacted", "booked"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export type CrmLead = {
  id: string;
  stage: LeadStage;
  label: string;
  customerPhoneLast4?: string;
  campaignHint?: string;
  updatedAt: string;
  bookedJobId?: string;
  source?: string;
};

export type LeadLifecycleCard = {
  stage: LeadStage;
  title: string;
  why: string;
  leads: CrmLead[];
};

export type LeadLifecycleSummary = {
  sentences: string[];
  cards: LeadLifecycleCard[];
  leadCount: number;
  contactedCount: number;
  bookedCount: number;
  writes: false;
};

export type LeadLifecycleRecDraft = {
  type: "lead_lifecycle";
  title: string;
  rationale: string;
  why: string;
  crmWrite: "later";
  leadCount: number;
  contactedCount: number;
  bookedCount: number;
};

export type BookedJobSignalRecDraft = {
  type: "booked_job";
  title: string;
  rationale: string;
  why: string;
  bookedJobCount: number;
  bookedJoinCount: number;
  campaignName?: string;
  canProposeBudget: boolean;
};

const STAGE_COPY: Record<LeadStage, { title: string; why: string }> = {
  lead: {
    title: "New lead",
    why: "Someone asked for help. Call or text them next.",
  },
  contacted: {
    title: "Contacted",
    why: "The shop reached this person. Book the job when they are ready.",
  },
  booked: {
    title: "Booked",
    why: "A job is on the calendar. Cerevex can use this as an ads signal.",
  },
};

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === "string" && (LEAD_STAGES as readonly string[]).includes(value);
}

export function mockHcpLeads(clientName: string, now = new Date()): CrmLead[] {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const shop = clientName.trim() || "this shop";
  return [
    {
      id: "hcp-lead-1",
      stage: "lead",
      label: `${shop} — new ductless inquiry`,
      customerPhoneLast4: "7788",
      campaignHint: "HVAC leads",
      updatedAt: hoursAgo(8),
      source: "ads",
    },
    {
      id: "hcp-lead-2",
      stage: "contacted",
      label: `${shop} — called back, quote sent`,
      customerPhoneLast4: "4410",
      campaignHint: "HVAC leads",
      updatedAt: hoursAgo(16),
      source: "ads",
    },
    {
      id: "hcp-lead-3",
      stage: "booked",
      label: `${shop} ductless install — booked`,
      customerPhoneLast4: "1201",
      campaignHint: "HVAC leads",
      updatedAt: now.toISOString(),
      bookedJobId: "hcp-mock-1",
      source: "ads",
    },
  ];
}

export function summarizeLeadLifecycle(leads: CrmLead[]): LeadLifecycleSummary {
  const byStage = (stage: LeadStage) => leads.filter((row) => row.stage === stage);
  const leadRows = byStage("lead");
  const contactedRows = byStage("contacted");
  const bookedRows = byStage("booked");
  const sentences: string[] = [];
  if (leads.length === 0) {
    sentences.push("No leads pulled yet. Connect Housecall Pro and pull to see the common path.");
  } else {
    sentences.push(
      `${leads.length} lead${leads.length === 1 ? "" : "s"} on the common path: ${leadRows.length} new, ${contactedRows.length} contacted, ${bookedRows.length} booked.`,
    );
    if (bookedRows.length > 0) {
      sentences.push("A booked job can feed ads recommendations. Nothing was written to Housecall Pro.");
    }
  }
  const cards: LeadLifecycleCard[] = LEAD_STAGES.map((stage) => ({
    stage,
    title: STAGE_COPY[stage].title,
    why: STAGE_COPY[stage].why,
    leads: byStage(stage),
  }));
  return {
    sentences,
    cards,
    leadCount: leadRows.length,
    contactedCount: contactedRows.length,
    bookedCount: bookedRows.length,
    writes: false,
  };
}

export function recsFromLeadLifecycle(leads: CrmLead[]): LeadLifecycleRecDraft[] {
  if (leads.length === 0) return [];
  const summary = summarizeLeadLifecycle(leads);
  return [
    {
      type: "lead_lifecycle",
      title:
        summary.bookedCount > 0
          ? `${summary.bookedCount} lead${summary.bookedCount === 1 ? "" : "s"} booked`
          : `${summary.leadCount + summary.contactedCount} lead${summary.leadCount + summary.contactedCount === 1 ? "" : "s"} still open`,
      why: summary.sentences[0] ?? "Leads moved on the common path inside Cerevex.",
      rationale: `${summary.sentences.join(" ")} CRM apply later — Cerevex does not write Housecall Pro from this card.`,
      crmWrite: "later",
      leadCount: summary.leadCount,
      contactedCount: summary.contactedCount,
      bookedCount: summary.bookedCount,
    },
  ];
}

export function recsFromBookedJobSignal(input: {
  bookedJobs: BookedJob[];
  bookedJoinCount: number;
  campaignName?: string;
  canProposeBudget: boolean;
}): BookedJobSignalRecDraft[] {
  const open = input.bookedJobs.filter((job) => job.status === "booked" || job.status === "completed");
  if (open.length === 0 && input.bookedJoinCount <= 0) return [];
  const campaign = input.campaignName;
  const why = campaign
    ? `${open.length || input.bookedJoinCount} booked job${(open.length || input.bookedJoinCount) === 1 ? "" : "s"} joined to ${campaign}. That campaign is earning work.`
    : `${open.length || input.bookedJoinCount} booked job${(open.length || input.bookedJoinCount) === 1 ? "" : "s"} pulled. Use this as an ads signal.`;
  return [
    {
      type: "booked_job",
      title: campaign ? `Booked jobs point to ${campaign}` : "Booked jobs as an ads signal",
      why,
      rationale: input.canProposeBudget
        ? `${why} Approve can move a little budget toward the campaign that booked work. Deny and Snooze write nothing.`
        : `${why} Review only in this slice — Approve records the signal and does not write ads until the flag is on.`,
      bookedJobCount: open.length,
      bookedJoinCount: input.bookedJoinCount,
      campaignName: campaign,
      canProposeBudget: input.canProposeBudget,
    },
  ];
}

export function crmWriteBlockedReason(recommendationType?: string | null): string | null {
  if (recommendationType !== "lead_lifecycle") return null;
  return "crm_write_later";
}

export function publicLeadView(lead: CrmLead): CrmLead {
  return {
    id: lead.id,
    stage: isLeadStage(lead.stage) ? lead.stage : "lead",
    label: lead.label,
    customerPhoneLast4: lead.customerPhoneLast4,
    campaignHint: lead.campaignHint,
    updatedAt: lead.updatedAt,
    bookedJobId: lead.bookedJobId,
    source: lead.source,
  };
}
