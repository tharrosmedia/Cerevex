"use client";

import { applyStatusLabel, connectionStatusLabel, summarizeMutation } from "@tharros/ads-shared";
import { Button } from "@/components/ui/button";
import { platformLabel, titleCase } from "@/lib/format";

export function ApproveSheet({
  open,
  clientName,
  platform,
  entities,
  mutations,
  risk,
  killSwitchOn,
  frozen,
  submitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  clientName: string;
  platform: string | null;
  entities: string[];
  mutations: unknown[];
  risk: string;
  killSwitchOn: boolean;
  frozen: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const blocked = killSwitchOn || frozen;
  const lines = mutations.map((row) =>
    summarizeMutation(
      row && typeof row === "object"
        ? (row as {
            action?: string;
            platform?: string;
            target?: { name?: string; entityType?: string; externalId?: string };
            payload?: Record<string, unknown>;
          })
        : {},
    ),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-title"
        className="w-full max-w-lg rounded-xl bg-background text-foreground shadow-lg ring-1 ring-border"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="approve-title" className="font-heading text-xl font-medium">
            Approve this change?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">This will change live ads.</p>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 text-sm">
          <p>
            <span className="text-muted-foreground">Client</span>
            <br />
            {clientName}
          </p>
          <p>
            <span className="text-muted-foreground">Platform</span>
            <br />
            {platform ? platformLabel(platform) : "Unknown"}
          </p>
          <p>
            <span className="text-muted-foreground">Entities</span>
            <br />
            {entities.length > 0 ? entities.join(", ") : "See mutation list"}
          </p>
          <div>
            <p className="text-muted-foreground">What will change</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {lines.length > 0 ? lines.map((line) => <li key={line}>{line}</li>) : <li>No mutations listed.</li>}
            </ul>
          </div>
          <p>
            <span className="text-muted-foreground">Risk</span>
            <br />
            {titleCase(risk)}
          </p>
          {blocked ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {killSwitchOn
                ? "Approve is blocked while ads are paused on this workspace."
                : "Approve is blocked because this ad account is frozen."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={submitting} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting || blocked} className="w-full sm:w-auto">
            {submitting ? "Approving…" : "Approve and apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ApplyStatus({
  status,
  error,
  response,
}: {
  status: string | null | undefined;
  error?: string | null;
  response?: Record<string, unknown> | null;
}) {
  if (!status) return null;
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <p className="font-medium">Apply status: {applyStatusLabel(status)}</p>
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}
      {response ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(response, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function ConnectionLabel({ status, mock }: { status: string; mock?: boolean }) {
  return (
    <span>
      {connectionStatusLabel(status)}
      {mock ? " · mock" : ""}
    </span>
  );
}
