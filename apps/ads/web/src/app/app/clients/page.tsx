"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AdAccountPublic, AuditRunPublic, ClientSummary, RecommendationPublic } from "@tharros/ads-shared";
import { MODULE_COPY } from "@tharros/ads-shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleOff } from "@/components/cockpit/module-off";
import { EmptyCard, ErrorCard, LoadingGrid } from "@/components/cockpit/page-state";
import { MetricDetails } from "@/components/cockpit/metric-details";
import { ConnectionBadge } from "@/components/cockpit/status-badge";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { ApiError, getClient, listClientAudits, listClientRecommendations, listClients } from "@/lib/api";
import { formatWhen, platformLabel } from "@/lib/format";

type ClientCard = {
  client: ClientSummary;
  accounts: AdAccountPublic[];
  latestAudit: AuditRunPublic | null;
  proposedCount: number;
};

export default function ClientsPage() {
  const { modules, loading } = useWorkspace();
  const [cards, setCards] = useState<ClientCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modules.clients) return;
    let cancelled = false;
    (async () => {
      const clients = await listClients();
      const rows = await Promise.all(
        clients.map(async (client) => {
          const [detail, audits, recommendations] = await Promise.all([
            getClient(client.id),
            listClientAudits(client.id),
            listClientRecommendations(client.id),
          ]);
          return {
            client,
            accounts: detail.adAccounts,
            latestAudit: audits[0] ?? null,
            proposedCount: recommendations.filter((row: RecommendationPublic) => row.status === "proposed").length,
          };
        }),
      );
      if (!cancelled) setCards(rows);
    })().catch((err) => {
      if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load clients.");
    });
    return () => {
      cancelled = true;
    };
  }, [modules.clients]);

  if (!loading && !modules.clients) {
    return <ModuleOff title={MODULE_COPY.clients.label} help={MODULE_COPY.clients.help} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
          <h2 className="font-heading text-3xl font-medium tracking-tight">Clients</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {MODULE_COPY.clients.help} Open a client to connect ads, review recommendations, or pause ads.
          </p>
        </div>
      </div>

      {error ? (
        <ErrorCard title="Could not load clients" message={error} />
      ) : cards === null ? (
        <LoadingGrid />
      ) : cards.length === 0 ? (
        <EmptyCard
          title="No clients yet"
          description="This account is signed in but is not a member of any client. Ask an owner to grant access, or sign in as the seeded owner."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map(({ client, accounts, latestAudit, proposedCount }) => (
            <Link key={client.id} href={`/app/clients/${client.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/30">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="font-heading text-xl">{client.name}</CardTitle>
                    {client.pilotFlag ? <Badge variant="secondary">Pilot</Badge> : null}
                  </div>
                  <CardDescription className="capitalize">{client.status}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
                  {accounts.length === 0 ? (
                    <p>No ad accounts connected yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {accounts.map((account) => (
                        <li key={account.id} className="flex items-center justify-between gap-2">
                          <span>{platformLabel(account.platform)}</span>
                          <ConnectionBadge status={account.connectionStatus} mock={account.mock} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <MetricDetails>
                    Last sync {formatWhen(client.lastSyncAt, "never")}
                    {latestAudit ? ` · last audit ${latestAudit.status}` : " · no audits yet"}
                    {proposedCount > 0 ? ` · ${proposedCount} proposed` : ""}
                  </MetricDetails>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
