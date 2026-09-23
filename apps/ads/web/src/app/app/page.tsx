"use client";

import Link from "next/link";
import { MODULE_COPY } from "@tharros/ads-shared";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { adsRailFor } from "@/lib/ads-nav";

export default function AdsOverviewPage() {
  const { modules, capabilities, workspace } = useWorkspace();
  const enabled = adsRailFor(modules, capabilities);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ads</p>
        <h2 className="font-heading text-3xl font-medium tracking-tight">Overview</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Only the modules you turned on are listed here. Change them anytime in Settings → Modules.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {enabled.map((item) => {
          const copy = item.module ? MODULE_COPY[item.module] : null;
          return (
            <Link key={item.href} href={item.href} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/30">
                <CardHeader>
                  <CardTitle className="font-heading text-xl">{item.label}</CardTitle>
                  <CardDescription>{copy?.help ?? "Open this Ads module."}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        {workspace?.businessType
          ? "You can add or remove modules later without changing how ads apply."
          : "Choose a business type to set the starting modules."}{" "}
        <Link href="/app/settings" className="text-foreground underline">
          Modules
        </Link>
      </p>
    </div>
  );
}
