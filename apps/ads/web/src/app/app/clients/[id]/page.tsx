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
} from "@tharros/ads-shared";
import { MODULE_COPY, isCapabilityVisible } from "@tharros/ads-shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleOff } from "@/components/cockpit/module-off";
import { FindingCard } from "@/components/cockpit/finding-card";
import { MetricDetails } from "@/components/cockpit/metric-details";
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
  connectBundledCallTracking,
  connectCallRail,
  connectCrmMock,
  disconnectAdAccount,
  getOfflineAttribution,
  mockConnect,
  pullBundledCallTracking,
  pullCallRail,
  setAdAccountFrozen,
  startInlineAudit,
  startOAuth,
  syncAdAccount,
} from "@/lib/api";
import { ApproveSheet } from "@/components/cockpit/approve-sheet";
import { connectionStatusLabel } from "@tharros/ads-shared";
import { formatWhen } from "@/lib/format";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "meta", label: "Meta" },
  { id: "google", label: "Google Ads" },
];

const REC_FILTERS = ["all", "proposed", "authorized", "denied", "snoozed"] as const;
type RecFilter = (typeof REC_FILTERS)[number];

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { killSwitch, canMutate, canApprove, modules, capabilities, loading: workspaceLoading } = useWorkspace();
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
  const [advancedConnect, setAdvancedConnect] = useState(false);
  const [offlineSentences, setOfflineSentences] = useState<string[]>([]);
  const callrailOn = isCapabilityVisible("m52.callrail_connect", capabilities);
  const bundledOn = isCapabilityVisible("m52.bundled_call_tracking", capabilities);
  const crmOn = isCapabilityVisible("m52.crm_join", capabilities);
  const [approveId, setApproveId] = useState<string | null>(null);
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
    const [recs, runs, offline] = await Promise.all([
      listClientRecommendations(id),
      listClientAudits(id),
      getOfflineAttribution(id).catch(() => null),
    ]);
    setOfflineSentences(offline?.sentences ?? []);
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

  async function decide(recommendationId: string, action: "deny" | "snooze") {
    setBusy(recommendationId);
    setError(null);
    try {
      const result = await decideRecommendation(recommendationId, action);
      setRecommendations((current) =>
        current.map((row) => (row.id === recommendationId ? result.recommendation : row)),
      );
      setNotice(result.note ?? `Recommendation ${action === "deny" ? "denied" : "snoozed"}. Nothing was written to Meta/Google.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  }

  async function approve(recommendationId: string) {
    setBusy(recommendationId);
    setError(null);
    try {
      const result = await decideRecommendation(recommendationId, "approve");
      setRecommendations((current) =>
        current.map((row) => (row.id === recommendationId ? result.recommendation : row)),
      );
      setNotice(result.note ?? "Approved. Apply is queued.");
      setApproveId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed.");
    } finally {
      setBusy(null);
    }
  }

  async function freezeAccount(accountId: string, frozen: boolean) {
    setBusy(`freeze-${accountId}`);
    setError(null);
    try {
      await setAdAccountFrozen(accountId, frozen);
      setNotice(frozen ? "Ad account frozen. Approve cannot write." : "Ad account unfrozen.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update freeze.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(accountId: string) {
    setBusy(`disconnect-${accountId}`);
    setError(null);
    try {
      await disconnectAdAccount(accountId);
      setNotice("Disconnected. Tokens were removed from the spine.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(null);
    }
  }

  if (!workspaceLoading && !modules.clients) {
    return <ModuleOff title={MODULE_COPY.clients.label} help={MODULE_COPY.clients.help} />;
  }

  if (error && !client) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorCard title="Client unavailable" message={error}>
          <Link href="/app/clients" className="text-sm text-foreground hover:underline">
            Back to clients
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
        <Link href="/app/clients" className="text-xs text-muted-foreground hover:text-foreground">
          ← All clients
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-3xl font-medium tracking-tight">{client.name}</h2>
          {client.pilotFlag ? <Badge variant="secondary">Pilot</Badge> : null}
          <Badge variant="outline" className="capitalize">
            {client.status}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect ads, review recommendations, and pause ads from here. Spend details stay under Details.
        </p>
      </div>

      {notice ? <NoticeBanner>{notice}</NoticeBanner> : null}
      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <section className="grid gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ad accounts</p>
          <h3 className="mt-1 font-heading text-xl">Connect Meta / Connect Google</h3>
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
                      One-click OAuth. Tokens stay encrypted in the spine — never in the browser.
                    </CardDescription>
                  </div>
                  {account ? (
                    <ConnectionBadge status={account.connectionStatus} mock={account.mock} />
                  ) : (
                    <Badge variant="outline">{configured ? "Not connected" : "Needs app credentials"}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {account ? (
                  <>
                    <p className="text-muted-foreground">
                      {connectionStatusLabel(account.connectionStatus)} · {account.externalId} · last sync{" "}
                      {formatWhen(account.lastSyncAt)}
                      {account.frozen ? " · frozen" : ""}
                    </p>
                    {account.lastError ? (
                      <NoticeBanner tone="error">{account.lastError}</NoticeBanner>
                    ) : null}
                    {entities[account.id]?.length ? (
                      <ul className="space-y-2 text-muted-foreground">
                        {entities[account.id].slice(0, 6).map((entity) => (
                          <li key={entity.id}>
                            <span className="font-medium text-foreground">{entity.entityType}</span> · {entity.name}
                            {entity.metrics[0] ? (
                              <MetricDetails>
                                {entity.metrics[0].window} spend ${entity.metrics[0].spendUsd}
                              </MetricDetails>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No campaigns yet. Sync to pull them in.</p>
                    )}
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => sync(account.id)} disabled={busy === account.id} className="w-fit">
                          {busy === account.id ? "Queueing…" : account.connectionStatus === "needs_reconnect" ? "Reconnect / Sync now" : "Sync now"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => freezeAccount(account.id, !account.frozen)}
                          disabled={busy === `freeze-${account.id}`}
                        >
                          {account.frozen ? "Unfreeze" : "Freeze account"}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => disconnect(account.id)}
                          disabled={busy === `disconnect-${account.id}`}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      {configured
                        ? `Connect ${platform.label} with one click. Sync starts after connect.`
                        : `${platform.label} app credentials are not in this environment. Use Advanced mock connect for local/CI only.`}
                    </p>
                    {canManage ? (
                      <div className="flex flex-col gap-2">
                        <Button
                          onClick={() => connect(platform.id)}
                          disabled={busy === platform.id || !configured}
                          className="w-fit"
                        >
                          {busy === platform.id ? "Working…" : `Connect ${platform.label === "Google Ads" ? "Google" : platform.label}`}
                        </Button>
                        {!configured ? (
                          <div>
                            <button
                              type="button"
                              className="text-xs text-muted-foreground underline"
                              onClick={() => setAdvancedConnect((open) => !open)}
                            >
                              {advancedConnect ? "Hide advanced" : "Advanced"}
                            </button>
                            {advancedConnect ? (
                              <div className="mt-2">
                                <p className="mb-2 text-xs text-muted-foreground">
                                  Mock connect stores encrypted fake tokens. Not the pilot path.
                                </p>
                                <Button
                                  variant="outline"
                                  onClick={() => connect(platform.id)}
                                  disabled={busy === platform.id}
                                >
                                  Mock-connect {platform.label}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
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

      {callrailOn || bundledOn || crmOn ? (
        <Card>
          <CardHeader>
            <CardTitle>CallRail and booked jobs</CardTitle>
            <CardDescription>
              Calls join to campaigns in plain language. Mock is QA-safe. Nothing is written to CallRail, Twilio, or Housecall Pro.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {offlineSentences.length > 0 ? (
              <ul className="space-y-1 text-muted-foreground">
                {offlineSentences.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {callrailOn
                  ? "Connect CallRail, then pull calls to see joins."
                  : "Enable bundled call tracking, then pull calls to see joins."}
              </p>
            )}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {callrailOn ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy === "callrail"}
                      onClick={async () => {
                        setBusy("callrail");
                        setError(null);
                        try {
                          await connectCallRail({ clientId: id, mock: true });
                          await pullCallRail(id);
                          await refresh();
                          setNotice("CallRail mock connected. Calls joined in plain language.");
                        } catch (err) {
                          setError(err instanceof ApiError ? err.message : "CallRail connect failed.");
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Connect CallRail (mock)
                    </Button>
                  </>
                ) : null}
                {bundledOn ? (
                  <Button
                    variant="outline"
                    disabled={busy === "bundled"}
                    onClick={async () => {
                      setBusy("bundled");
                      setError(null);
                      try {
                        await connectBundledCallTracking({ clientId: id, mock: true });
                        await pullBundledCallTracking(id);
                        await refresh();
                        setNotice("Bundled mock connected. Calls joined in plain language. No number was bought.");
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "Bundled connect failed.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Enable bundled (mock)
                  </Button>
                ) : null}
                {crmOn ? (
                  <Button
                    variant="outline"
                    disabled={busy === "crm"}
                    onClick={async () => {
                      setBusy("crm");
                      setError(null);
                      try {
                        await connectCrmMock(id);
                        await refresh();
                        setNotice("Housecall Pro mock-joined. No CRM write.");
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "CRM join failed.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Soft-join Housecall Pro
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
          <CardTitle>Recommendations</CardTitle>
          <CardDescription>
            Approve, Deny, or Snooze. Only Approve writes platforms
            {killSwitch ? " — and only after ads are unpaused." : "."}
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
                  canApprove={canApprove}
                  killSwitchOn={killSwitch}
                  frozen={accounts.find((row) => row.id === rec.adAccountId)?.frozen}
                  busy={busy}
                  onDecide={decide}
                  onApprove={(id) => setApproveId(id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ApproveSheet
        open={Boolean(approveId)}
        clientName={client.name}
        platform={
          approveId
            ? accounts.find((row) => row.id === recommendations.find((rec) => rec.id === approveId)?.adAccountId)
                ?.platform ?? null
            : null
        }
        entities={
          approveId
            ? (recommendations.find((rec) => rec.id === approveId)?.proposedMutations ?? []).flatMap((mutation) => {
                const target = (mutation as { target?: { name?: string } }).target;
                return target?.name ? [target.name] : [];
              })
            : []
        }
        mutations={approveId ? (recommendations.find((rec) => rec.id === approveId)?.proposedMutations ?? []) : []}
        risk={approveId ? recommendations.find((rec) => rec.id === approveId)?.risk ?? "medium" : "medium"}
        killSwitchOn={killSwitch}
        frozen={Boolean(
          approveId &&
            accounts.find((row) => row.id === recommendations.find((rec) => rec.id === approveId)?.adAccountId)?.frozen,
        )}
        submitting={busy === approveId}
        onCancel={() => setApproveId(null)}
        onConfirm={() => (approveId ? approve(approveId) : undefined)}
      />
    </div>
  );
}
