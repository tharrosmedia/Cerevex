"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClientSummary } from "@tharros/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, listClients } from "@/lib/api";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listClients()
      .then(setClients)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load clients.");
      });
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-primary">HVAC pilots</p>
          <h2 className="font-heading text-3xl font-medium tracking-tight">Three shops. One spine.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Got Ductless, KC Prestige, and Elmar HVAC are seeded as M1 pilots. You only see clients
            your membership allows — owner and operator see the workspace; client users stay scoped.
          </p>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Could not load pilots</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : clients === null ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Card key={key} className="h-44 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No clients in scope</CardTitle>
            <CardDescription>
              This account is signed in but is not a member of any client. Ask an owner to grant
              access, or sign in as the seeded owner.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {clients.map((client) => (
            <Link key={client.id} href={`/app/clients/${client.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="font-heading text-xl">{client.name}</CardTitle>
                    {client.pilotFlag ? <Badge variant="secondary">Pilot</Badge> : null}
                  </div>
                  <CardDescription className="capitalize">{client.status}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {client.connectedPlatforms && client.connectedPlatforms.length > 0
                    ? `Connected: ${client.connectedPlatforms.join(", ")}`
                    : "No ad accounts connected yet."}
                  {client.lastSyncAt ? ` · synced ${new Date(client.lastSyncAt).toLocaleDateString()}` : ""}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
