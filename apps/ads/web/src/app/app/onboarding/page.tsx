"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUSINESS_TYPE_HELP,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  type BusinessType,
} from "@tharros/ads-shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/cockpit/workspace-context";
import { ApiError, patchWorkspace } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh, canMutate } = useWorkspace();
  const [pending, setPending] = useState<BusinessType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(businessType: BusinessType) {
    setPending(businessType);
    setError(null);
    try {
      await patchWorkspace({ businessType });
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save business type.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Get started</p>
        <h2 className="font-heading text-3xl font-medium tracking-tight">What kind of business is this?</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This sets which Ads modules you see. Leads stay on for everyone. You can change modules later in
          Settings.
        </p>
      </div>

      <div className="grid gap-4">
        {BUSINESS_TYPES.map((type) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="font-heading text-xl">{BUSINESS_TYPE_LABELS[type]}</CardTitle>
              <CardDescription>{BUSINESS_TYPE_HELP[type]}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                onClick={() => choose(type)}
                disabled={!canMutate || pending !== null}
              >
                {pending === type ? "Saving…" : `Use ${BUSINESS_TYPE_LABELS[type]}`}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : !canMutate ? (
        <p className="text-sm text-muted-foreground">Only an owner or operator can choose the business type.</p>
      ) : null}
    </div>
  );
}
