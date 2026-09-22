"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type {
  AdAccountPublic,
  AdEntityPublic,
  ClientSummary,
  FindingPublic,
  Platform,
  RecommendationPublic,
} from "@tharros/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "meta", label: "Meta" },
  { id: "google", label: "Google Ads" },
];

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [accounts, setAccounts] = useState<AdAccountPublic[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [oauth, setOauth] = useState<{ meta: boolean; google: boolean }>({ meta: false, google: false });
  const [entities, setEntities] = useState<Record<string, AdEntityPublic[]>>({});
  const [findings, setFindings] = useState<FindingPublic[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getClient(id);
    setClient(result.client);
    setAccounts(result.adAccounts);
    setCanManage(result.canManage);
    setOauth({ meta: result.oauth.meta.configured, google: result.oauth.google.configured });
    const next: Record<string, AdEntityPublic[]> = {};
    for (const account of result.adAccounts) {
      if (account.connectionStatus === "connected" || account.connectionStatus === "error") {
        const detail = await getAdAccount(account.id);
        next[account.id] = detail.entities;
      }
    }
    setEntities(next);
    const recs = await listClientRecommendations(id);
    setRecommendations(recs);
    const audits = await listClientAudits(id);
    if (audits[0]) {
      const bundle = await getAudit(audits[0].id);
      setFindings(bundle.findings);
    }
  }, [id]);

  useEffect(() => {
    refresh().catch((err) => {
      setError(err instanceof ApiError ? err.message : "Could not load this client.");
    });
  }, [refresh]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const connected = search.get("connected");
    const oauthError = search.get("oauth_error");
    if (connected) setNotice(`${connected === "meta" ? "Meta" : "Google Ads"} connected. Tokens stay in the spine.`);
    if (oauthError) setError(`OAuth did not finish (${oauthError}).`);
  }, []);

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

  if (error && !client) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Client unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/app" className="text-sm text-primary hover:underline">
              Back to pilots
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function runAudit() {
    setBusy("audit");
    setError(null);
    try {
      const bundle = await startInlineAudit(id);
      setFindings(bundle.findings);
      setRecommendations(bundle.recommendations);
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

  if (!client) {
    return <div className="text-sm text-muted-foreground">Loading client…</div>;
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
      </div>

      {notice ? (
        <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4">
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
                      Read-only. Tokens are encrypted in the spine and never sent to the browser.
                    </CardDescription>
                  </div>
                  {account ? (
                    <Badge variant={account.connectionStatus === "error" ? "destructive" : "secondary"}>
                      {account.connectionStatus}
                      {account.mock ? " · mock" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{configured ? "Not connected" : "App not configured"}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {account ? (
                  <>
                    <p className="text-muted-foreground">
                      Account {account.externalId}
                      {account.lastSyncAt ? ` · last sync ${new Date(account.lastSyncAt).toLocaleString()}` : " · never synced"}
                    </p>
                    {account.lastError ? (
                      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                        {account.lastError}
                      </p>
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
                      <Button
                        onClick={() => sync(account.id)}
                        disabled={busy === account.id}
                        className="w-fit"
                      >
                        {busy === account.id
                          ? "Queueing…"
                          : account.lastError
                            ? "Retry sync"
                            : "Sync now"}
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
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>M3 audit</CardTitle>
              <CardDescription>
                Reads local synced tables only. Recommendations are propose-only. Apply stays behind
                the kill switch.
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
          {findings.length === 0 && recommendations.length === 0 ? (
            <p className="text-muted-foreground">
              Sync an account, then run a mock audit. No live spend and no Meta/Google writes.
            </p>
          ) : null}
          {findings.length > 0 ? (
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">Findings</p>
              <ul className="space-y-2">
                {findings.map((finding) => (
                  <li key={finding.id} className="rounded-md border border-border px-3 py-2">
                    <span className="font-medium">{finding.title}</span>
                    <span className="ml-2 text-xs uppercase text-muted-foreground">{finding.severity}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {recommendations.length > 0 ? (
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Recommendations
              </p>
              <ul className="space-y-3">
                {recommendations.map((rec) => (
                  <li key={rec.id} className="rounded-md border border-border px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{rec.title}</p>
                        <p className="mt-1 text-muted-foreground">{rec.rationale}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {rec.type} · {rec.status} · risk {rec.risk}
                          {rec.estimatedImpactUsd ? ` · est. $${rec.estimatedImpactUsd}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline">{rec.status}</Badge>
                    </div>
                    {canManage && rec.status === "proposed" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => decide(rec.id, "authorize")} disabled={busy === rec.id}>
                          Authorize
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide(rec.id, "deny")}
                          disabled={busy === rec.id}
                        >
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decide(rec.id, "snooze")}
                          disabled={busy === rec.id}
                        >
                          Snooze
                        </Button>
                      </div>
                    ) : null}
                    {canManage && rec.status === "authorized" ? (
                      <Button
                        size="sm"
                        className="mt-3"
                        variant="outline"
                        onClick={() => apply(rec.id)}
                        disabled={busy === `apply-${rec.id}`}
                      >
                        Request apply (blocked)
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
