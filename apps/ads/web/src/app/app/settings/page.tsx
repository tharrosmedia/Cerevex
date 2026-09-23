"use client";

import { useState } from "react";
import {
  ADS_MODULE_IDS,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  LEADS_NOT_LIVE_COPY,
  MODULE_COPY,
  OPERATOR_CAPABILITY_CATALOG_LIST,
  isLeadsProductUnfinished,
  type AdsModuleId,
  type BusinessType,
  type CapabilityId,
  type CapabilityState,
} from "@tharros/ads-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { ApiError, patchWorkspace } from "@/lib/api";

export default function AdsModulesSettingsPage() {
  const { workspace, modules, capabilities, canMutate, killSwitch, refresh } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveType(businessType: BusinessType) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await patchWorkspace({ businessType });
      await refresh();
      setMessage(`Modules set for ${BUSINESS_TYPE_LABELS[businessType]}. You can still turn modules on or off below.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save business type.");
    } finally {
      setPending(false);
    }
  }

  async function toggle(id: AdsModuleId, enabled: boolean) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await patchWorkspace({ modules: { [id]: enabled } });
      await refresh();
      setMessage(`${MODULE_COPY[id].label} is now ${enabled ? "on" : "off"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save modules.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Settings</p>
        <h2 className="font-heading text-3xl font-medium tracking-tight">Modules</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          The Ads menu only shows modules that are on. Changing a module here does not apply ads or spend money.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business type</CardTitle>
          <CardDescription>
            Current: {workspace?.businessType ? BUSINESS_TYPE_LABELS[workspace.businessType] : "Not chosen yet"}.
            Picking a type resets modules to the defaults for that type.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          {BUSINESS_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              variant={workspace?.businessType === type ? "default" : "outline"}
              disabled={!canMutate || pending}
              onClick={() => saveType(type)}
            >
              {BUSINESS_TYPE_LABELS[type]}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ads modules</CardTitle>
          <CardDescription>Turn a module on if you need it. Leave it off if you do not.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ADS_MODULE_IDS.map((id) => {
            const leadsLocked = id === "leads" && isLeadsProductUnfinished();
            return (
              <label key={id} className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
                <span>
                  <span className="block font-medium">{MODULE_COPY[id].label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{MODULE_COPY[id].help}</span>
                  {leadsLocked ? (
                    <span className="mt-1 block text-sm text-muted-foreground">{LEADS_NOT_LIVE_COPY}</span>
                  ) : null}
                </span>
                {leadsLocked ? (
                  <span className="mt-1 text-sm text-muted-foreground">Not live</span>
                ) : (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-black"
                    checked={modules[id]}
                    disabled={!canMutate || pending}
                    onChange={(event) => toggle(id, event.target.checked)}
                  />
                )}
              </label>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>
            Per-workspace product flags. Work that is not live yet is not listed here.
            Flip a flag here — Site Brain does not need a redeploy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {OPERATOR_CAPABILITY_CATALOG_LIST.map((entry) => (
            <label key={entry.id} className="flex items-start justify-between gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
              <span>
                <span className="block font-medium">
                  {entry.label}
                  {entry.unfinished ? " · unfinished" : ""}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{entry.help}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{entry.id}</span>
              </span>
              <select
                className="mt-1 border border-border bg-background px-2 py-1 text-sm"
                value={capabilities[entry.id]}
                disabled={!canMutate || pending}
                onChange={(event) => {
                  const state = event.target.value as CapabilityState;
                  void (async () => {
                    setPending(true);
                    setError(null);
                    setMessage(null);
                    try {
                      await patchWorkspace({ capabilities: { [entry.id as CapabilityId]: state } });
                      await refresh();
                      setMessage(`${entry.label} is now ${state.replace(/_/g, " ")}.`);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "Could not save capability.");
                    } finally {
                      setPending(false);
                    }
                  })();
                }}
              >
                <option value="on">On</option>
                <option value="recommend_only">Recommend only</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pause ads</CardTitle>
          <CardDescription>
            Workspace kill switch. When on, Approve cannot apply. Default is on.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">{killSwitch ? "Ads are paused. Nothing goes live." : "Ads can run. Approve still needs a human."}</p>
          <Button
            type="button"
            variant={killSwitch ? "outline" : "default"}
            disabled={!canMutate || pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              setMessage(null);
              try {
                await patchWorkspace({ applyKillSwitch: !killSwitch });
                await refresh();
                setMessage(!killSwitch ? "Ads paused. Approve is blocked." : "Ads unpaused. Approve can apply.");
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not update pause ads.");
              } finally {
                setPending(false);
              }
            }}
          >
            {killSwitch ? "Turn pause off" : "Pause ads"}
          </Button>
        </CardContent>
      </Card>

      {message ? <p className="text-sm">{message}</p> : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
