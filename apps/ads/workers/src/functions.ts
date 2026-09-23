import { ADS_FUNCTION_IDS, LEGACY_ADS_EVENTS, LEGACY_ADS_FUNCTION_IDS } from "@cerevex/contracts";
import { runApplyJob } from "@tharros/ads-shared/apply";
import { runAuditRun, writeAuditEvent } from "@tharros/ads-shared/audit";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Cerevex ads orchestration (R5 / G7). Platform is event data, not the namespace.
 * Folder paths jobs/meta/ads and jobs/google/ads stay; they register legacy
 * meta/ads/* and google/ads/* listeners for one release so in-flight jobs finish.
 * Apply still runs evaluateApplyGate (kill switch + authorize + freeze).
 */

async function handleStubPing({ event, step }: any) {
  await step.run("complete-stub", async () => {
    await writeInngestAudit({
      workspaceId: event.data.workspaceId,
      actorId: event.data.requestedBy,
      action: "jobs.stub_complete",
      payload: {
        event: event.name,
        note: event.data.note,
        clientId: event.data.clientId,
        stub: true,
        platforms: "none",
      },
    });
  });
  return { ok: true, stub: true, processedAt: new Date().toISOString() };
}

async function handleStubSync({ event, step }: any) {
  if (event.data.adAccountId) {
    return step.run("delegate-m2-sync", async () => runAdAccountSync(event.data.adAccountId as string));
  }
  await step.run("complete-stub", async () => {
    await writeInngestAudit({
      workspaceId: event.data.workspaceId,
      actorId: event.data.requestedBy,
      action: "jobs.stub_complete",
      payload: {
        event: event.name,
        clientId: event.data.clientId,
        note: "No ad account id — nothing to pull.",
      },
    });
  });
  return { ok: true, stub: true, processedAt: new Date().toISOString() };
}

async function handleApplyRequested({ event, step }: any) {
  const applyJobId = event.data.applyJobId as string | undefined;
  if (!applyJobId) {
    await step.run("audit-missing-job", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "apply_fail",
        payload: { event: event.name, error: "applyJobId required" },
      });
    });
    return { ok: false, error: "applyJobId required" };
  }

  const result = await step.run("execute-authorized-mutations", async () => {
    return runApplyJob(applyJobId);
  });

  await step.run("audit-apply", async () => {
    await writeAuditEvent({
      workspaceId: event.data.workspaceId,
      actorType: "worker",
      actorId: event.data.requestedBy,
      action: result.applyJob.status === "succeeded" ? "apply_success" : "apply_fail",
      entityType: "apply_job",
      entityId: applyJobId,
      payload: {
        event: event.name,
        clientId: event.data.clientId,
        authorizationId: event.data.authorizationId,
        applyJobId,
        writes: result.writes,
        blocked: result.blocked,
        outcomes: result.outcomes,
        error: result.applyJob.error,
      },
    });
  });

  return {
    ok: result.applyJob.status === "succeeded",
    applyJobId,
    status: result.applyJob.status,
    writes: result.writes,
    blocked: result.blocked,
    outcomes: result.outcomes,
  };
}

async function handleAuditRequested({ event, step }: any) {
  const bundle = await step.run("evaluate-local-tables", async () => {
    return runAuditRun(event.data.auditRunId as string);
  });

  return {
    ok: true,
    auditRunId: event.data.auditRunId,
    findingCount: bundle.findings.length,
    recommendationCount: bundle.recommendations.length,
    writes: false,
  };
}

async function handleAccountSync({ event, step }: any) {
  const result = await step.run("pull-entities", async () => runAdAccountSync(event.data.adAccountId));
  await step.run("audit", async () => {
    await writeInngestAudit({
      workspaceId: event.data.workspaceId,
      actorId: event.data.requestedBy,
      action: result.status === "error" ? "jobs.sync_failed" : "jobs.sync_complete",
      payload: {
        event: event.name,
        clientId: event.data.clientId,
        adAccountId: event.data.adAccountId,
        platform: event.data.platform,
        mode: result.mode,
        entityCount: result.entityCount,
        lastError: result.lastError,
        writes: false,
      },
    });
  });
  return result;
}

export const stubPing = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.stubPing, name: "Ads stub ping", triggers: [{ event: EVENTS.stubPing }] },
  handleStubPing,
);

export const stubPingLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.stubPing,
    name: "Ads stub ping (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.stubPing }],
  },
  handleStubPing,
);

export const stubSync = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.stubSync, name: "Ads stub sync", triggers: [{ event: EVENTS.stubSync }] },
  handleStubSync,
);

export const stubSyncLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.stubSync,
    name: "Ads stub sync (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.stubSync }],
  },
  handleStubSync,
);

export const applyRequested = inngest.createFunction(
  {
    id: ADS_FUNCTION_IDS.applyRequested,
    name: "Ads apply requested",
    triggers: [{ event: EVENTS.applyRequested }],
    idempotency: "event.data.applyJobId",
  },
  handleApplyRequested,
);

export const applyRequestedLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.applyRequested,
    name: "Ads apply requested (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.applyRequested }],
    idempotency: "event.data.applyJobId",
  },
  handleApplyRequested,
);

export const auditRequested = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.auditRequested, name: "Ads audit requested", triggers: [{ event: EVENTS.auditRequested }] },
  handleAuditRequested,
);

export const auditRequestedLegacy = inngest.createFunction(
  {
    id: LEGACY_ADS_FUNCTION_IDS.auditRequested,
    name: "Ads audit requested (legacy os/*)",
    triggers: [{ event: LEGACY_ADS_EVENTS.auditRequested }],
  },
  handleAuditRequested,
);

export const accountSync = inngest.createFunction(
  { id: ADS_FUNCTION_IDS.accountSync, name: "Ads account sync", triggers: [{ event: EVENTS.accountSync }] },
  handleAccountSync,
);

export const adsFunctions = [
  stubPing,
  stubPingLegacy,
  stubSync,
  stubSyncLegacy,
  applyRequested,
  applyRequestedLegacy,
  auditRequested,
  auditRequestedLegacy,
  accountSync,
];

/** @deprecated R5 alias */
export const osFunctions = adsFunctions;

export const ADS_WORKER_FUNCTION_IDS = [
  ADS_FUNCTION_IDS.stubPing,
  LEGACY_ADS_FUNCTION_IDS.stubPing,
  ADS_FUNCTION_IDS.stubSync,
  LEGACY_ADS_FUNCTION_IDS.stubSync,
  ADS_FUNCTION_IDS.applyRequested,
  LEGACY_ADS_FUNCTION_IDS.applyRequested,
  ADS_FUNCTION_IDS.auditRequested,
  LEGACY_ADS_FUNCTION_IDS.auditRequested,
  ADS_FUNCTION_IDS.accountSync,
] as const;

/** @deprecated R5 alias */
export const OS_FUNCTION_IDS = ADS_WORKER_FUNCTION_IDS;
