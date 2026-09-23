"use client";

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
            <CardTitle>Not live yet</CardTitle>
            <CardDescription>{LEADS_NOT_LIVE_COPY}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Coming later</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Leads</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Not open yet</CardTitle>
          <CardDescription>
            This space is reserved for lead ideas. Nothing here changes ads today.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          When this ships, you can sketch campaign ideas here. Ads stay paused until you say otherwise.
        </CardContent>
      </Card>
    </div>
  );
}
