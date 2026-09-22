"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { KillSwitchBanner, KillSwitchPill } from "@/components/cockpit/kill-switch-banner";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { adsNavFor, adsRailFor } from "@/lib/ads-nav";
import { logout } from "@/lib/api";
import { consoleHref } from "@/lib/console-origin";

function isAdsPath(pathname: string | null) {
  return Boolean(pathname?.startsWith("/app"));
}

function isOnboardingExempt(pathname: string | null) {
  return pathname === "/app/onboarding" || pathname === "/app/settings";
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { killSwitch, workspaceName, error, modules, onboardingComplete, loading } = useWorkspace();
  const [adsOpen, setAdsOpen] = useState(false);
  const adsMenuRef = useRef<HTMLDivElement>(null);
  const adsCurrent = isAdsPath(pathname);
  const adsItems = adsNavFor(modules);
  const rail = adsCurrent ? adsRailFor(modules) : [];

  useEffect(() => {
    setAdsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (loading || onboardingComplete || isOnboardingExempt(pathname)) return;
    router.replace("/app/onboarding");
  }, [loading, onboardingComplete, pathname, router]);

  useEffect(() => {
    if (!adsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (adsMenuRef.current?.contains(event.target as Node)) return;
      setAdsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [adsOpen]);

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
            {adsCurrent ? (
              <div
                ref={adsMenuRef}
                className={adsOpen ? "site-nav-relative site-nav-pair is-open" : "site-nav-relative site-nav-pair"}
              >
                <Link href="/app" className="site-nav-current">
                  Ads
                </Link>
                <button
                  type="button"
                  onClick={() => setAdsOpen((open) => !open)}
                  aria-expanded={adsOpen}
                  aria-haspopup="true"
                  aria-controls="ads-menu"
                  aria-label="Ads menu"
                >
                  {adsOpen ? "▴" : "▾"}
                </button>
                {adsOpen && (
                  <div className="site-nav-menu" id="ads-menu" role="menu">
                    {adsItems.map((item) => (
                      <Link key={`${item.label}-${item.href}`} href={item.href} onClick={() => setAdsOpen(false)}>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link href="/app">Ads</Link>
            )}
            <a href={consoleHref("/review")} onClick={() => setAdsOpen(false)}>Review</a>
            <a href={consoleHref("/stores")} onClick={() => setAdsOpen(false)}>Stores</a>
            <a href={consoleHref("/settings")} onClick={() => setAdsOpen(false)}>Settings</a>
          </nav>
          <div className="site-nav-rail">
            {rail.length > 0 && (
              <div className="site-nav-rail-items">
                {rail.map((item) => {
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
            )}
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
