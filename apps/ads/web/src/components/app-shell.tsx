"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Lightbulb, LogOut, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KillSwitchBanner, KillSwitchPill } from "@/components/cockpit/kill-switch-banner";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { logout } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", label: "Ads", icon: LayoutGrid, exact: true },
  { href: "/app/brainstorm", label: "Leads", icon: Lightbulb },
  { href: "/app/workflows", label: "Workflows", icon: Workflow },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, killSwitch, workspaceName, error } = useWorkspace();

  async function onLogout() {
    await logout();
    router.replace("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <aside className="border-b border-sidebar-border bg-sidebar md:flex md:w-64 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/app" className="flex items-baseline gap-2">
            <span className="font-heading text-xl tracking-tight">Cerevex</span>
          </Link>
          <p className="hidden pt-1 text-xs text-muted-foreground md:block">Ads for home service</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden items-center justify-between gap-2 border-t border-sidebar-border px-4 py-3 md:flex">
          <div className="min-w-0">
            <p className="truncate text-sm">{user?.name ?? "…"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email ?? ""}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onLogout}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
            <h1 className="font-heading text-lg">{workspaceName ?? "Cerevex"}</h1>
          </div>
          <div className="flex items-center gap-3">
            <KillSwitchPill on={killSwitch} />
            <Button variant="ghost" size="sm" className="md:hidden" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </header>
        <div className="border-b border-border px-4 py-3 md:px-8">
          <KillSwitchBanner on={killSwitch} />
        </div>
        <main className="flex-1 px-4 py-6 md:px-8">
          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
