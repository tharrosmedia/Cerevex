"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AdAccountPublic,
  AdEntityPublic,
  AuditRunPublic,
  ClientSummary,
  FindingPublic,
  Platform,
  RecommendationPublic,
} from "@tharros/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindingCard } from "@/components/cockpit/finding-card";
import { EmptyCard, ErrorCard, LoadingLines, NoticeBanner } from "@/components/cockpit/page-state";
import { RecommendationCard } from "@/components/cockpit/recommendation-card";
import { ConnectionBadge } from "@/components/cockpit/status-badge";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import {
  ApiError,
  decideRecommendation,
  getAdAccount,
  getAudit,
  getClient,
  listClientAudits,
  listClientRecommendations,
  mockConnect,
  requestApply,
  startInlineAudit,
  startOAuth,
  syncAdAccount,
} from "@/lib/api";
import { formatWhen } from "@/lib/format";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "meta", label: "Meta" },
  { id: "google", label: "Google Ads" },
];

const REC_FILTERS = ["all", "proposed", "authorized", "denied", "snoozed"] as const;
type RecFilter = (typeof REC_FILTERS)[number];

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { killSwitch, canMutate } = useWorkspace();
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [accounts, setAccounts] = useState<AdAccountPublic[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [oauth, setOauth] = useState<{ meta: boolean; google: boolean }>({ meta: false, google: false });
  const [entities, setEntities] = useState<Record<string, AdEntityPublic[]>>({});
  const [audits, setAudits] = useState<AuditRunPublic[]>([]);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingPublic[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationPublic[]>([]);
  const [recFilter, setRecFilter] = useState<RecFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selectedAuditIdRef = useRef<string | null>(null);
  selectedAuditIdRef.current = selectedAuditId;

  const refresh = useCallback(async () => {
    const result = await getClient(id);
    setClient(result.client);
    setAccounts(result.adAccounts);
    setCanManage(result.canManage);
    setOauth({ meta: result.oauth.meta.configured, google: result.oauth.google.configured });
    const next: Record<string, AdEntityPublic[]> = {};
    await Promise.all(
      result.adAccounts
        .filter((account) => account.connectionStatus === "connected" || account.connectionStatus === "error")
        .map(async (account) => {
          const detail = await getAdAccount(account.id);
          next[account.id] = detail.entities;
        }),
    );
    setEntities(next);
    const [recs, runs] = await Promise.all([listClientRecommendations(id), listClientAudits(id)]);
    setRecommendations(recs);
    setAudits(runs);
    const current = selectedAuditIdRef.current;
    const preferred = current && runs.some((run) => run.id === current) ? current : runs[0]?.id;
    setSelectedAuditId(preferred ?? null);
    if (preferred) {
      const bundle = await getAudit(preferred);
      setFindings(bundle.findings);
    } else {
      setFindings([]);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load this client.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const connected = search.get("connected");
    const oauthError = search.get("oauth_error");
    if (connected) setNotice(`${connected === "meta" ? "Meta" : "Google Ads"} connected. Tokens stay in the spine.`);
    if (oauthError) setError(`OAuth did not finish (${oauthError}).`);
  }, []);

  const selectedAudit = useMemo(
    () => audits.find((run) => run.id === selectedAuditId) ?? null,
    [audits, selectedAuditId],
  );

  const visibleRecs = useMemo(
    () =>
      recFilter === "all" ? recommendations : recommendations.filter((row) => row.status === recFilter),
    [recommendations, recFilter],
  );

  async function selectAudit(auditId: string) {
    setSelectedAuditId(auditId);
    setBusy(`audit-${auditId}`);
    setError(null);
    try {
      const bundle = await getAudit(auditId);
      setFindings(bundle.findings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that audit.");
    } finally {
      setBusy(null);
    }
  }

  async function connect(platform: Platform) {
    setBusy(platform);
    setError(null);
    try {
      if (oauth[platform]) {
        window.location.href = await startOAuth(id, platform);
        return;
      }
      await mockConnect(id, platform);
      setNotice(`Mock ${platform === "meta" ? "Meta" : "Google Ads"} connection stored. No live platform call.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed.");
    } finally {
      setBusy(null);
    }
  }

  async function sync(accountId: string) {
    setBusy(accountId);
    setError(null);
    try {
      await syncAdAccount(accountId);
      setNotice("Sync queued. The worker pulls entities without blocking this page.");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue sync.");
    } finally {
      setBusy(null);
    }
  }

  async function runAudit() {
    setBusy("audit");
    setError(null);
    try {
      const bundle = await startInlineAudit(id);
      setFindings(bundle.findings);
      setRecommendations(bundle.recommendations);
      setSelectedAuditId(bundle.audit.id);
      setAudits((current) => [bundle.audit, ...current.filter((row) => row.id !== bundle.audit.id)]);
      setNotice(
        `Mock audit complete. ${bundle.findings.length} findings, ${bundle.recommendations.length} proposed recs. No platform writes.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(recommendationId: string, action: "authorize" | "deny" | "snooze") {
    setBusy(recommendationId);
    setError(null);
    try {
      const result = await decideRecommendation(recommendationId, action);
      setRecommendations((current) =>
        current.map((row) => (row.id === recommendationId ? result.recommendation : row)),
      );
      setNotice(
        action === "authorize"
          ? "Authorized. Apply is a separate step and stays blocked while the kill switch is on."
          : `Recommendation ${action === "deny" ? "denied" : "snoozed"}. Nothing was written to Meta/Google.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  }

  async function apply(recommendationId: string) {
    setBusy(`apply-${recommendationId}`);
    setError(null);
    try {
      await requestApply(recommendationId);
      setNotice("Apply unexpectedly succeeded.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply blocked.";
      setNotice(message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !client) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorCard title="Client unavailable" message={error}>
          <Link href="/app" className="text-sm text-primary hover:underline">
            Back to pilots
          </Link>
        </ErrorCard>
      </div>
    );
  }

  if (loading && !client) {
    return (
      <div className="mx-auto max-w-3xl">
        <LoadingLines label="Loading client, ad accounts, and audits…" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyCard title="Client not found" description="This client is not in your membership scope." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link href="/app" className="text-xs text-muted-foreground hover:text-foreground">
          ← All pilots
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-3xl font-medium tracking-tight">{client.name}</h2>
          {client.pilotFlag ? <Badge variant="secondary">Pilot</Badge> : null}
          <Badge variant="outline" className="capitalize">
            {client.status}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Read path only. Mock OAuth is fine until live secrets. Authorize ≠ apply.
        </p>
      </div>

      {notice ? <NoticeBanner>{notice}</NoticeBanner> : null}
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <section className="grid gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ad accounts</p>
          <h3 className="mt-1 font-heading text-xl">Read-only connections</h3>
        </div>
        {PLATFORMS.map((platform) => {
          const account = accounts.find((row) => row.platform === platform.id);
          const configured = oauth[platform.id];
          return (
            <Card key={platform.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{platform.label}</CardTitle>
                    <CardDescription>
                      Tokens are encrypted in the spine and never sent to the browser.
                    </CardDescription>
                  </div>
                  {account ? (
                    <ConnectionBadge status={account.connectionStatus} mock={account.mock} />
                  ) : (
                    <Badge variant="outline">{configured ? "Not connected" : "App not configured"}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {account ? (
                  <>
                    <p className="text-muted-foreground">
                      Account {account.externalId} · last sync {formatWhen(account.lastSyncAt)}
                    </p>
                    {account.lastError ? (
                      <NoticeBanner tone="error">{account.lastError}</NoticeBanner>
                    ) : null}
                    {entities[account.id]?.length ? (
                      <ul className="space-y-1 text-muted-foreground">
                        {entities[account.id].slice(0, 6).map((entity) => (
                          <li key={entity.id}>
                            <span className="font-medium text-foreground">{entity.entityType}</span> · {entity.name}
                            {entity.metrics[0]
                              ? ` · ${entity.metrics[0].window} spend $${entity.metrics[0].spendUsd}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No entities yet. Run a sync to pull campaigns and metrics.</p>
                    )}
                    {canManage ? (
                      <Button onClick={() => sync(account.id)} disabled={busy === account.id} className="w-fit">
                        {busy === account.id ? "Queueing…" : account.lastError ? "Retry sync" : "Sync now"}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      {configured
                        ? "Connect this pilot with first-party OAuth. The callback stays on the API."
                        : "Developer app credentials are not in this environment. Mock connect stores encrypted fake tokens so local and CI can run."}
                    </p>
                    {canManage ? (
                      <Button onClick={() => connect(platform.id)} disabled={busy === platform.id} className="w-fit">
                        {busy === platform.id
                          ? "Working…"
                          : configured
                            ? `Connect ${platform.label}`
                            : `Mock-connect ${platform.label}`}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">Only owners and operators can connect accounts.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Audits</CardTitle>
              <CardDescription>
                Reads local synced tables only. Recommendations stay proposed until a human decides.
              </CardDescription>
            </div>
            {canManage ? (
              <Button onClick={() => runAudit()} disabled={busy === "audit"} className="w-fit">
                {busy === "audit" ? "Auditing…" : "Run mock audit"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {audits.length === 0 ? (
            <p className="text-muted-foreground">
              {accounts.length === 0
                ? "Mock-connect an account, sync, then run a mock audit."
                : "No audits yet. Run a mock audit to generate findings and proposed recommendations."}
            </p>
          ) : (
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">History</p>
              <ul className="space-y-2">
                {audits.map((run) => {
                  const summary = run.summary as {
                    findingCount?: number;
                    recommendationCount?: number;
                    mode?: string;
                  };
                  const active = run.id === selectedAuditId;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => selectAudit(run.id)}
                        disabled={busy === `audit-${run.id}`}
                        className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-primary/50 bg-primary/10"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium capitalize">{run.status}</span>
                          <span className="text-xs text-muted-foreground">{formatWhen(run.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {summary.findingCount ?? 0} findings · {summary.recommendationCount ?? 0} recs
                          {summary.mode ? ` · ${summary.mode}` : ""} · writes false
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {selectedAudit ? (
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Findings · {selectedAudit.status}
              </p>
              {findings.length === 0 ? (
                <p className="text-muted-foreground">This audit has no findings.</p>
              ) : (
                <ul className="space-y-2">
                  {findings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed recommendations</CardTitle>
          <CardDescription>
            Authorize, deny, or snooze. Apply remains a separate step
            {killSwitch ? " and is blocked while the kill switch is on." : "."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {REC_FILTERS.map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={recFilter === filter ? "secondary" : "ghost"}
                onClick={() => setRecFilter(filter)}
                className="capitalize"
              >
                {filter}
                {filter === "all"
                  ? ` (${recommendations.length})`
                  : ` (${recommendations.filter((row) => row.status === filter).length})`}
              </Button>
            ))}
          </div>
          {visibleRecs.length === 0 ? (
            <p className="text-muted-foreground">
              {recommendations.length === 0
                ? "No recommendations yet. Run a mock audit after a sync."
                : `No ${recFilter} recommendations.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {visibleRecs.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  canManage={canManage && canMutate}
                  killSwitchOn={killSwitch}
                  busy={busy}
                  onDecide={decide}
                  onApply={apply}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
