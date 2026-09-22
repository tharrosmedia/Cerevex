"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { KillSwitchBanner, KillSwitchPill } from "@/components/cockpit/kill-switch-banner";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { logout } from "@/lib/api";
import { consoleHref } from "@/lib/console-origin";

const ADS_SUB = [
  { href: "/app", label: "Overview" },
  { href: "/app", label: "Clients", rail: "Clients", match: (path: string) => path === "/app" || path.startsWith("/app/clients") },
  { href: "/app/brainstorm", label: "Leads", rail: "Leads" },
  { href: "/app/workflows", label: "Workflows", rail: "Workflows" },
];

function isAdsPath(pathname: string | null) {
  return Boolean(pathname?.startsWith("/app"));
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { killSwitch, workspaceName, error } = useWorkspace();
  const [adsOpen, setAdsOpen] = useState(false);
  const adsCurrent = isAdsPath(pathname);

  useEffect(() => {
    setAdsOpen(false);
  }, [pathname]);

  async function onLogout() {
    await logout();
    router.replace("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="site-header">
        <div className="site-header-inner">
          <a href={consoleHref("/")} className="site-wordmark" aria-label="Cerevex home">
            Cerevex
          </a>
          <nav className="site-nav" aria-label="Cerevex">
            <a href={consoleHref("/seo")}>SEO</a>
            <div className="site-nav-relative site-nav-pair">
              <Link href="/app" className={adsCurrent ? "site-nav-current" : undefined}>
                Ads
              </Link>
              <button
                type="button"
                onClick={() => setAdsOpen((open) => !open)}
                aria-expanded={adsOpen}
                aria-haspopup="true"
                aria-label="Ads menu"
              >
                {adsOpen ? "▴" : "▾"}
              </button>
              {adsOpen && (
                <div className="site-nav-menu">
                  {ADS_SUB.map((item) => (
                    <Link key={`${item.label}-${item.href}`} href={item.href} onClick={() => setAdsOpen(false)}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <a href={consoleHref("/review")}>Review</a>
            <a href={consoleHref("/stores")}>Stores</a>
            <a href={consoleHref("/settings")}>Settings</a>
          </nav>
          <div className="site-nav-rail">
            <div className="site-nav-rail-items">
              {ADS_SUB.filter((item) => item.rail).map((item) => {
                const current = item.match
                  ? item.match(pathname ?? "")
                  : Boolean(pathname?.startsWith(item.href));
                return (
                  <Link
                    key={item.rail}
                    href={item.href}
                    className={current ? "site-nav-current" : undefined}
                  >
                    {item.rail}
                  </Link>
                );
              })}
            </div>
            <div className="site-store-switch site-workspace-switch">
              <span className="site-workspace-name" title={workspaceName ?? undefined}>
                {workspaceName ?? "Cerevex"}
              </span>
              <span className="site-rail-pill">
                <KillSwitchPill on={killSwitch} />
              </span>
              <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Sign out">
                Sign out
              </Button>
            </div>
          </div>
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
  );
}
