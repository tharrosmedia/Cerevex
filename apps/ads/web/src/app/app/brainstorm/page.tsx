"use client";

import Link from "next/link";
import { isLeadsSurfaceVisible, LEADS_NOT_LIVE_COPY, MODULE_COPY } from "@tharros/ads-shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/cockpit/workspace-context";

export default function BrainstormPlaceholderPage() {
  const { modules, capabilities, loading } = useWorkspace();
  if (!loading && !isLeadsSurfaceVisible(modules, capabilities)) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
        <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">{MODULE_COPY.leads.label}</h2>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Use in-shell Brainstorm</CardTitle>
            <CardDescription>{LEADS_NOT_LIVE_COPY}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Brainstorm</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Open in-shell Leads</CardTitle>
          <CardDescription>
            Grok alternatives, Promote, and Approve live on the console /ads/leads path. Leftover chrome does not generate ads.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          <Link href="/ads/leads" className="underline">
            Go to /ads/leads
          </Link>
          . Generate never writes live ads.
        </CardContent>
      </Card>
    </div>
  );
}
