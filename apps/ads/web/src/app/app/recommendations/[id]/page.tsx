"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { applyStatusLabel, summarizeMutation } from "@tharros/ads-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyStatus, ApproveSheet } from "@/components/cockpit/approve-sheet";
import { ErrorCard, LoadingLines, NoticeBanner } from "@/components/cockpit/page-state";
import { RecStatusBadge, RiskBadge } from "@/components/cockpit/status-badge";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { ApiError, decideRecommendation, getRecommendation, type ApplyJobPublic } from "@/lib/api";
import { asProposedMutations, formatMoney, platformLabel, titleCase } from "@/lib/format";

export default function RecommendationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { killSwitch, canApprove, refresh } = useWorkspace();
  const [data, setData] = useState<Awaited<ReturnType<typeof getRecommendation>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await getRecommendation(id);
    setData(result);
  }, [id]);

  useEffect(() => {
    load().catch((err) => {
      setError(err instanceof ApiError ? err.message : "Could not load this recommendation.");
    });
  }, [load]);

  const rec = data?.recommendation;
  const mutations = useMemo(() => (rec ? asProposedMutations(rec.proposedMutations) : []), [rec]);
  const entities = useMemo(
    () => [...new Set(mutations.map((row) => row.targetName).filter((value): value is string => Boolean(value)))],
    [mutations],
  );

  async function denyOrSnooze(action: "deny" | "snooze") {
    setBusy(action);
    setError(null);
    try {
      const result = await decideRecommendation(id, action);
      setData((current) =>
        current
          ? { ...current, recommendation: result.recommendation, authorization: result.authorization, applyJob: result.applyJob }
          : current,
      );
      setNotice(result.note ?? (action === "deny" ? "Denied. Nothing was written." : "Snoozed. Nothing was written."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that decision.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const result = await decideRecommendation(id, "approve");
      setData((current) =>
        current
          ? { ...current, recommendation: result.recommendation, authorization: result.authorization, applyJob: result.applyJob }
          : current,
      );
      setNotice(result.note ?? "Approved. Apply is queued.");
      setConfirmOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !rec) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorCard title="Recommendation unavailable" message={error}>
          <Link href="/app/clients" className="text-sm hover:underline">
            Back to clients
          </Link>
        </ErrorCard>
      </div>
    );
  }

  if (!rec) {
    return (
      <div className="mx-auto max-w-3xl">
        <LoadingLines label="Loading recommendation…" />
      </div>
    );
  }

  const applyJob: ApplyJobPublic | null = data?.applyJob ?? null;
  const frozen = Boolean(data?.adAccount?.frozen);
  const open = rec.status === "proposed";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={data?.client ? `/app/clients/${data.client.id}` : "/app/clients"}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {data?.client?.name ?? "Client"}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-3xl font-medium tracking-tight">{rec.title}</h2>
          <RecStatusBadge status={rec.status} />
          <RiskBadge risk={rec.risk} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{rec.rationale}</p>
      </div>

      {notice ? <NoticeBanner>{notice}</NoticeBanner> : null}
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <Card>
        <CardHeader>
          <CardTitle>What this changes</CardTitle>
          <CardDescription>
            {data?.client?.name ?? "Client"} · {data?.adAccount ? platformLabel(data.adAccount.platform) : "Platform"}
            {formatMoney(rec.estimatedImpactUsd) ? ` · est. ${formatMoney(rec.estimatedImpactUsd)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            <span className="text-muted-foreground">Type</span> · {titleCase(rec.type)}
          </p>
          {entities.length > 0 ? (
            <p>
              <span className="text-muted-foreground">Entities</span> · {entities.join(", ")}
            </p>
          ) : null}
          <ul className="space-y-1">
            {rec.proposedMutations.map((mutation, index) => (
              <li key={`${rec.id}-m-${index}`}>{summarizeMutation(mutation as never)}</li>
            ))}
          </ul>
          <ApplyStatus status={applyJob?.status} error={applyJob?.error} response={applyJob?.response} />
          {applyJob ? (
            <p className="text-xs text-muted-foreground">
              Latest apply: {applyStatusLabel(applyJob.status)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {open ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canApprove || killSwitch || frozen || busy !== null}
            className="w-full sm:w-auto"
          >
            Approve
          </Button>
          <Button variant="outline" onClick={() => denyOrSnooze("deny")} disabled={busy !== null} className="w-full sm:w-auto">
            {busy === "deny" ? "Saving…" : "Deny"}
          </Button>
          <Button variant="ghost" onClick={() => denyOrSnooze("snooze")} disabled={busy !== null} className="w-full sm:w-auto">
            {busy === "snooze" ? "Saving…" : "Snooze"}
          </Button>
        </div>
      ) : null}

      {!canApprove && open ? (
        <p className="text-sm text-muted-foreground">
          Approve is limited to Adam during soft-launch. Deny and Snooze still write nothing to the platforms.
        </p>
      ) : null}
      {canApprove && open && (killSwitch || frozen) ? (
        <p className="text-sm text-muted-foreground">
          {killSwitch
            ? "Turn off the workspace pause before Approve can apply."
            : "Unfreeze this ad account before Approve can apply."}
        </p>
      ) : null}

      <ApproveSheet
        open={confirmOpen}
        clientName={data?.client?.name ?? "Client"}
        platform={data?.adAccount?.platform ?? null}
        entities={entities}
        mutations={rec.proposedMutations}
        risk={rec.risk}
        killSwitchOn={killSwitch}
        frozen={frozen}
        submitting={busy === "approve"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={approve}
      />
    </div>
  );
}
