import { runApplyJob } from "@tharros/ads-shared/apply";
import { runAuditRun, writeAuditEvent } from "@tharros/ads-shared/audit";
import { EVENTS, inngest } from "@tharros/ads-shared/inngest";
import { runAdAccountSync } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Shared OS orchestration. Kill-switch + authorize-to-apply.
 * Platform sync lives in jobs/meta/ads and jobs/google/ads.
 * Apply executes schema-valid mutate-existing proposed_mutations only.
 */

export const stubPing = inngest.createFunction(
  { id: "os-stub-ping", name: "OS stub ping", triggers: [{ event: EVENTS.stubPing }] },
  async ({ event, step }: any) => {
    await step.run("complete-stub", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "jobs.stub_complete",
        payload: {
          event: EVENTS.stubPing,
          note: event.data.note,
          clientId: event.data.clientId,
          stub: true,
          platforms: "none",
        },
      });
    });
    return { ok: true, stub: true, processedAt: new Date().toISOString() };
  },
);

export const stubSync = inngest.createFunction(
  { id: "os-stub-sync", name: "OS legacy stub sync", triggers: [{ event: EVENTS.stubSync }] },
  async ({ event, step }: any) => {
    if (event.data.adAccountId) {
      return step.run("delegate-m2-sync", async () => runAdAccountSync(event.data.adAccountId as string));
    }
    await step.run("complete-stub", async () => {
      await writeInngestAudit({
        workspaceId: event.data.workspaceId,
        actorId: event.data.requestedBy,
        action: "jobs.stub_complete",
        payload: {
          event: EVENTS.stubSync,
          clientId: event.data.clientId,
          note: "No ad account id — nothing to pull.",
        },
      });
    });
    return { ok: true, stub: true, processedAt: new Date().toISOString() };
  },
);

export const applyRequested = inngest.createFunction(
  {
    id: "os-apply-requested",
    name: "OS apply requested",
    triggers: [{ event: EVENTS.applyRequested }],
    idempotency: "event.data.applyJobId",
  },
  async ({ event, step }: any) => {
    const applyJobId = event.data.applyJobId as string | undefined;
    if (!applyJobId) {
      await step.run("audit-missing-job", async () => {
        await writeInngestAudit({
          workspaceId: event.data.workspaceId,
          actorId: event.data.requestedBy,
          action: "apply_fail",
          payload: { event: EVENTS.applyRequested, error: "applyJobId required" },
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
          event: EVENTS.applyRequested,
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
  },
);

export const auditRequested = inngest.createFunction(
  { id: "os-audit-requested", name: "OS audit requested", triggers: [{ event: EVENTS.auditRequested }] },
  async ({ event, step }: any) => {
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
  },
);

export const osFunctions = [stubPing, stubSync, applyRequested, auditRequested];
export const OS_FUNCTION_IDS = [
  "os-stub-ping",
  "os-stub-sync",
  "os-apply-requested",
  "os-audit-requested",
] as const;
