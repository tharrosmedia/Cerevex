"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, apiUrl, getToken } from "@/lib/api";

interface ReviewPacketView {
  weekOf?: string;
  note?: string;
  nothingToActOn?: boolean;
  checked?: { loop: string; status: string }[];
  notChecked?: { loop: string; status: string }[];
  counts?: { doNow: number; test: number; needsData: number };
}

export function AccountReviewCard({ clientId }: { clientId: string }) {
  const [packet, setPacket] = useState<ReviewPacketView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    api<{ rows: { payload: ReviewPacketView; createdAt: string }[] }>(
      `/clients/${clientId}/audit-log?action=account_review&limit=1`,
    )
      .then((result) => {
        if (cancel) return;
        setPacket(result.rows[0]?.payload ?? null);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cancel) return;
        setError(cause instanceof ApiError ? cause.message : "The weekly packet could not be loaded.");
        setLoaded(true);
      });
    return () => {
      cancel = true;
    };
  }, [clientId]);

  async function download(format: "csv" | "json", action?: string) {
    const key = `${format}:${action ?? "all"}`;
    setBusy(key);
    try {
      const params = new URLSearchParams({ format });
      if (action) params.set("action", action);
      const token = getToken();
      const res = await fetch(`${apiUrl()}/clients/${clientId}/audit-log/export?${params}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = action ? `account-review-${clientId}.${format}` : `audit-log-${clientId}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  const checked = packet?.checked?.map((line) => line.loop).join(", ");
  const notChecked = packet?.notChecked?.map((line) => line.loop) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly account review</CardTitle>
        <CardDescription>
          Paid and SEO loops only. Other loops stay not checked. The audit log export is the same route slice 1 already has.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!loaded ? <p className="text-muted-foreground">Loading the latest packet.</p> : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {loaded && !error && !packet ? (
          <p className="text-muted-foreground">No weekly packet yet. Checked, nothing to act on is a valid result once a week runs.</p>
        ) : null}
        {packet ? (
          <div className="flex flex-col gap-2">
            <p>
              {packet.weekOf ? `Week of ${packet.weekOf}. ` : ""}
              {packet.note ?? "Checked, nothing to act on."}
            </p>
            {checked ? <p className="text-muted-foreground">Checked: {checked}.</p> : null}
            {notChecked.length > 0 ? (
              <p className="text-muted-foreground">Not checked: {notChecked.join(", ")}.</p>
            ) : null}
            {packet.counts ? (
              <p className="text-muted-foreground">
                Do now {packet.counts.doNow} · Test {packet.counts.test} · Needs data {packet.counts.needsData}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("csv", "account_review")}>
            {busy === "csv:account_review" ? "Downloading" : "Packet CSV"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("json", "account_review")}>
            {busy === "json:account_review" ? "Downloading" : "Packet JSON"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => download("csv")}>
            {busy === "csv:all" ? "Downloading" : "Full audit CSV"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
