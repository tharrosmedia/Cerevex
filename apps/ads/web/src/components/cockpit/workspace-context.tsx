"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@tharros/ads-shared";
import { ApiError, getWorkspace, me } from "@/lib/api";

type WorkspaceState = {
  user: SessionUser | null;
  killSwitch: boolean;
  canMutate: boolean;
  workspaceName: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [killSwitch, setKillSwitch] = useState(true);
  const [canMutate, setCanMutate] = useState(false);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const session = await me();
    setUser(session.user);
    const result = await getWorkspace();
    setKillSwitch(result.workspace?.applyKillSwitch ?? true);
    setCanMutate(result.canMutate);
    setWorkspaceName(result.workspace?.name ?? null);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/sign-in");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load session");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, router]);

  const value = useMemo(
    () => ({ user, killSwitch, canMutate, workspaceName, loading, error, refresh }),
    [user, killSwitch, canMutate, workspaceName, loading, error, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
