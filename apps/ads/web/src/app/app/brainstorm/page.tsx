"use client";

import { isLeadsSurfaceVisible, LEADS_NOT_LIVE_COPY, MODULE_COPY } from "@tharros/ads-shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { consoleHref } from "@/lib/console-origin";

export default function BrainstormPlaceholderPage() {
  const { modules, capabilities, loading } = useWorkspace();
  if (!loading && !isLeadsSurfaceVisible(modules, capabilities)) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
        <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">{MODULE_COPY.leads.label}</h2>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Brainstorm lives in the Cerevex console</CardTitle>
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
          <CardTitle>Brainstorm lives in the Cerevex console</CardTitle>
          <CardDescription>
            Create ad ideas, then approve the ones you want. Nothing changes your live ads until you approve it.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          <a href={consoleHref("/ads/leads")} className="underline">
            Open Brainstorm
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
