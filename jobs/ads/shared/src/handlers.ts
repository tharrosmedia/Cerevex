import { pullGoogleAdAccount } from "@cerevex/jobs-ads-google/pull";
import { pullMetaAdAccount } from "@cerevex/jobs-ads-meta/pull";
import {
  applyResultAuditAction,
  applyingLeaseRemainingMs,
  closeApplyingJob,
  runApplyJob,
  shouldRecordApplyAudit,
} from "@tharros/ads-shared/apply";
import { runAuditRun, writeAuditEvent } from "@tharros/ads-shared/audit";
import { runAdAccountSync, syncJobAuditAction } from "@tharros/ads-shared/sync";
import { writeInngestAudit } from "@tharros/ads-shared/worker-audit";

/**
 * Shared step bodies for canonical ads/* functions and their os/* twins.
 * Platform sync entry points live in jobs/ads/meta and jobs/ads/google.
 * Connector / gate implementations stay in @tharros/ads-shared.
 */

export async function handleStubPing({ event, step }: any) {
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

export async function handleStubSync({ event, step }: any) {
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

export async function handleApplyRequested({ event, step }: any) {
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

  let result = await step.run("execute-authorized-mutations", async () => {
    return runApplyJob(applyJobId);
  });

  if (result.blocked === "in_progress") {
    const waitMs = await step.run("measure-applying-lease", async () =>
      applyingLeaseRemainingMs(result.applyJob.response),
    );
    if (waitMs > 0) {
      await step.sleep("wait-out-applying-lease", waitMs);
    }
    result = await step.run("recheck-applying-lease", async () => runApplyJob(applyJobId));
    if (result.blocked === "in_progress") {
      result = await step.run("close-stuck-applying", async () => closeApplyingJob(applyJobId));
    }
  }

  const recordedWrites = result.applyJob.response?.writes === "unknown" ? "unknown" : result.writes;

  if (shouldRecordApplyAudit(result)) {
    await step.run("audit-apply", async () => {
      await writeAuditEvent({
        workspaceId: event.data.workspaceId,
        actorType: "worker",
        actorId: event.data.requestedBy,
        action: applyResultAuditAction(result),
        entityType: "apply_job",
        entityId: applyJobId,
        payload: {
          event: event.name,
          clientId: event.data.clientId,
          authorizationId: event.data.authorizationId,
          applyJobId,
          writes: recordedWrites,
          blocked: result.blocked,
          outcomes: result.outcomes,
          error: result.applyJob.error,
        },
      });
    });
  }

  return {
    ok: result.applyJob.status === "succeeded",
    applyJobId,
    status: result.applyJob.status,
    writes: recordedWrites,
    blocked: result.blocked,
    outcomes: result.outcomes,
  };
}

export async function handleAuditRequested({ event, step }: any) {
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

export async function handleAccountSync({ event, step }: any) {
  const result = await step.run("pull-entities", async () => {
    const platform = event.data.platform as string | undefined;
    if (platform === "meta") return pullMetaAdAccount(event.data.adAccountId);
    if (platform === "google") return pullGoogleAdAccount(event.data.adAccountId);
    return runAdAccountSync(event.data.adAccountId);
  });
  await step.run("audit", async () => {
    await writeInngestAudit({
      workspaceId: event.data.workspaceId,
      actorId: event.data.requestedBy,
      action: syncJobAuditAction(result.status),
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
