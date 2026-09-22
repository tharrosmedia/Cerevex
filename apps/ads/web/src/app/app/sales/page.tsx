"use client";

import { MODULE_COPY } from "@tharros/ads-shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleOff } from "@/components/cockpit/module-off";
import { useWorkspace } from "@/components/cockpit/workspace-context";

export default function SalesPlaceholderPage() {
  const { modules, loading } = useWorkspace();

  if (!loading && !modules.sales) {
    return <ModuleOff title={MODULE_COPY.sales.label} help={MODULE_COPY.sales.help} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Coming later</p>
      <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight">Sales</h2>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Not open yet</CardTitle>
          <CardDescription>{MODULE_COPY.sales.help}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          This is a module flag only. Orders and a full sales tool are out of scope here. Ads stay paused until you
          apply a change.
        </CardContent>
      </Card>
    </div>
  );
}
