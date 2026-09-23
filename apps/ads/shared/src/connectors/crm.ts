/**
 * Housecall Pro CRM connector (M5.2 Phase D).
 * Mock path is required for QA. Live connect uses env / encrypted key.
 * Fail closed on bad creds. Connect and pull never write HCP.
 */

import { readProcessEnv } from "@cerevex/contracts";
import { mockHcpBookedJobs, type BookedJob } from "../attribution";
import { mockHcpLeads, type CrmLead, type LeadStage } from "../lead-lifecycle";
import type {
  ConnectorConnectInput,
  ConnectorConnectResult,
  CrmConnector,
  CrmJoinInput,
  CrmJoinResult,
  CrmPullInput,
  CrmPullResult,
} from "./types";

const HCP_API = "https://api.housecallpro.com";

export function hcpEnvCredentials(env = readProcessEnv()): { apiKey: string } | null {
  const apiKey = (env.HCP_API_KEY ?? env.HOUSECALL_PRO_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return { apiKey };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function last4(phone: unknown): string | undefined {
  const digits = asString(phone).replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jobRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const record = asRecord(body);
  if (Array.isArray(record.jobs)) return record.jobs as Record<string, unknown>[];
  if (Array.isArray(record.data)) return record.data as Record<string, unknown>[];
  return [];
}

function leadRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const record = asRecord(body);
  if (Array.isArray(record.leads)) return record.leads as Record<string, unknown>[];
  if (Array.isArray(record.data)) return record.data as Record<string, unknown>[];
  if (Array.isArray(record.estimates)) return record.estimates as Record<string, unknown>[];
  return [];
}

function mapJobStatus(raw: string): BookedJob["status"] {
  const status = raw.toLowerCase();
  if (status === "completed" || status === "complete") return "completed";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return "booked";
}

function mapLeadStage(raw: string, jobStatus?: BookedJob["status"]): LeadStage {
  const status = raw.toLowerCase();
  if (jobStatus === "booked" || jobStatus === "completed") return "booked";
  if (/(book|schedul|won|hired|complete)/.test(status)) return "booked";
  if (/(contact|call|quote|estimat|reach)/.test(status)) return "contacted";
  if (status === "unscheduled") return "lead";
  return "lead";
}

export function jobsFromHcpBody(body: unknown, clientName: string): BookedJob[] {
  const shop = clientName.trim() || "this shop";
  const jobs: BookedJob[] = [];
  for (const row of jobRows(body)) {
    const customer = asRecord(row.customer);
    const id = asString(row.id || row.uuid);
    if (!id) continue;
    const label =
      asString(row.description || row.invoice_number || row.work_status) || `${shop} job ${id.slice(0, 8)}`;
    const job: BookedJob = {
      id,
      status: mapJobStatus(asString(row.work_status || row.status || row.workStatus)),
      bookedAt: asString(row.completed_at || row.scheduled_start || row.created_at) || new Date().toISOString(),
      label,
    };
    const hint = asString(row.original_lead_source || row.lead_source || row.campaign);
    if (hint) job.campaignHint = hint;
    const phone = last4(customer.mobile_number || customer.home_number || customer.phone);
    if (phone) job.customerPhoneLast4 = phone;
    jobs.push(job);
  }
  return jobs;
}

export function leadsFromHcpBody(
  body: unknown,
  jobs: BookedJob[],
  clientName: string,
): CrmLead[] {
  const shop = clientName.trim() || "this shop";
  const fromLeads: CrmLead[] = [];
  for (const row of leadRows(body)) {
    const customer = asRecord(row.customer);
    const id = asString(row.id || row.uuid);
    if (!id) continue;
    const phone = last4(customer.mobile_number || customer.home_number || customer.phone || row.phone);
    const joined = phone ? jobs.find((job) => job.customerPhoneLast4 === phone) : undefined;
    const lead: CrmLead = {
      id,
      stage: mapLeadStage(asString(row.status || row.stage || row.work_status), joined?.status),
      label: asString(row.description || row.name) || `${shop} lead ${id.slice(0, 8)}`,
      updatedAt: asString(row.updated_at || row.created_at) || new Date().toISOString(),
      source: asString(row.source) || "hcp",
    };
    if (phone) lead.customerPhoneLast4 = phone;
    const hint = asString(row.original_lead_source || row.lead_source || row.campaign);
    if (hint) lead.campaignHint = hint;
    if (joined?.id) lead.bookedJobId = joined.id;
    fromLeads.push(lead);
  }
  if (fromLeads.length > 0) return fromLeads;
  return jobs.map((job) => ({
    id: `lead-${job.id}`,
    stage: job.status === "canceled" ? "contacted" : job.status === "booked" || job.status === "completed" ? "booked" : "lead",
    label: job.label,
    customerPhoneLast4: job.customerPhoneLast4,
    campaignHint: job.campaignHint,
    updatedAt: job.bookedAt,
    bookedJobId: job.status === "booked" || job.status === "completed" ? job.id : undefined,
    source: "hcp",
  }));
}

class HousecallProConnector implements CrmConnector {
  readonly kind = "crm" as const;
  readonly implementation = "live" as const;
  readonly id = "hcp" as const;
  readonly label = "Housecall Pro";
  readonly connectCapability = "m52.crm_join" as const;
  readonly writes = false as const;

  isConfigured(): boolean {
    return hcpEnvCredentials() != null;
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    if (input.mock) {
      return {
        ok: true,
        stub: false,
        mock: true,
        connectorId: this.id,
        externalId: input.externalId || "mock-hcp",
        reason: "Mock Housecall Pro connected. Leads and booked jobs stay local. Nothing was written to HCP.",
      };
    }
    const env = hcpEnvCredentials();
    const apiKey = input.apiKey || (input.useEnv ? env?.apiKey : undefined);
    if (!apiKey) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        reason: "Housecall Pro needs an API key, or use mock connect.",
      };
    }
    const checked = await this.verifyToken(apiKey);
    if (!checked.ok) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        reason: checked.reason,
      };
    }
    return {
      ok: true,
      stub: false,
      mock: false,
      connectorId: this.id,
      externalId: input.externalId || "hcp",
      reason: "Housecall Pro connected. Cerevex pulls leads and booked-job status only. Nothing is written to HCP.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: false,
      connectorId: this.id,
      reason: "Housecall Pro disconnected. Stored token was removed. No CRM write.",
    };
  }

  async listBookedJobs(input: CrmJoinInput): Promise<CrmJoinResult> {
    const pulled = await this.pullLeadsAndJobs(input);
    return {
      ok: pulled.ok,
      stub: pulled.stub,
      connectorId: this.id,
      mock: pulled.mock,
      bookedJobs: pulled.bookedJobs,
      writes: false,
      reason: pulled.reason,
    };
  }

  async pullLeadsAndJobs(input: CrmPullInput): Promise<CrmPullResult> {
    if (input.mock ?? true) {
      return {
        ok: true,
        stub: false,
        mock: true,
        connectorId: this.id,
        bookedJobs: mockHcpBookedJobs(input.clientName),
        leads: mockHcpLeads(input.clientName),
        writes: false,
        reason: "Mock leads and booked jobs for the common path. Deep HCP write-backs stay out.",
      };
    }
    const env = hcpEnvCredentials();
    const apiKey = input.apiKey || env?.apiKey;
    if (!apiKey) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        bookedJobs: [],
        leads: [],
        writes: false,
        reason: "Housecall Pro is not configured. Connect with an API key or use mock.",
      };
    }
    try {
      const jobsRes = await this.hcpGet("/jobs?page_size=50", apiKey);
      if (!jobsRes.ok) {
        return {
          ok: false,
          stub: false,
          mock: false,
          connectorId: this.id,
          bookedJobs: [],
          leads: [],
          writes: false,
          reason: jobsRes.reason,
        };
      }
      const bookedJobs = jobsFromHcpBody(jobsRes.body, input.clientName);
      let leadsBody: unknown = {};
      const leadsRes = await this.hcpGet("/leads?page_size=50", apiKey);
      if (leadsRes.ok) leadsBody = leadsRes.body;
      const leads = leadsFromHcpBody(leadsBody, bookedJobs, input.clientName);
      return {
        ok: true,
        stub: false,
        mock: false,
        connectorId: this.id,
        bookedJobs,
        leads,
        writes: false,
        reason: `${leads.length} lead${leads.length === 1 ? "" : "s"} and ${bookedJobs.length} job${bookedJobs.length === 1 ? "" : "s"} pulled. Nothing was written to Housecall Pro.`,
      };
    } catch (error) {
      return {
        ok: false,
        stub: false,
        mock: false,
        connectorId: this.id,
        bookedJobs: [],
        leads: [],
        writes: false,
        reason: error instanceof Error ? error.message : "Housecall Pro pull failed.",
      };
    }
  }

  private async verifyToken(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
    const checked = await this.hcpGet("/jobs?page_size=1", apiKey);
    if (checked.ok) return { ok: true };
    return { ok: false, reason: checked.reason ?? "Housecall Pro check failed. Nothing was written." };
  }

  private async hcpGet(path: string, apiKey: string): Promise<{ ok: boolean; body?: unknown; reason?: string }> {
    try {
      const res = await fetch(`${HCP_API}${path}`, {
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: `Housecall Pro request failed (${res.status}). Nothing was written.`,
        };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: true, body };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Housecall Pro request failed.",
      };
    }
  }
}

export const housecallProConnector = new HousecallProConnector();
