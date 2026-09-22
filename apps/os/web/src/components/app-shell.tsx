"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutGrid, Lightbulb, LogOut, Workflow } from "lucide-react";
import type { SessionUser } from "@tharros/shared";
import { Button } from "@/components/ui/button";
import { ApiError, getWorkspace, logout, me } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", label: "Clients", icon: LayoutGrid, exact: true },
  { href: "/app/brainstorm", label: "Brainstorm", icon: Lightbulb },
  { href: "/app/workflows", label: "Workflows", icon: Workflow },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [killSwitch, setKillSwitch] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((result) => {
        if (!cancelled) setUser(result.user);
        return getWorkspace();
      })
      .then((result) => {
        if (!cancelled && result.workspace) setKillSwitch(result.workspace.applyKillSwitch);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/sign-in");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load session");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onLogout() {
    await logout();
    router.replace("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-sidebar-border bg-sidebar md:flex md:w-64 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/app" className="flex items-baseline gap-2">
            <span className="font-heading text-xl tracking-tight">Tharros</span>
            <span className="font-mono text-xs text-primary">OS</span>
          </Link>
          <p className="hidden pt-1 text-xs text-muted-foreground md:block">Tharros Media</p>
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
            <p className="text-xs uppercase tracking-[0.16em] text-primary">Workspace</p>
            <h1 className="font-heading text-lg">Tharros Media</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
              Apply kill switch {killSwitch ? "on" : "off"}
            </span>
            <Button variant="ghost" size="sm" className="md:hidden" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </header>
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
