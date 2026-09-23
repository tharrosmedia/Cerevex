import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function KillSwitchBanner({
  on,
  compact = false,
  className,
}: {
  on: boolean;
  compact?: boolean;
  className?: string;
}) {
  const Icon = on ? ShieldAlert : ShieldCheck;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2",
        on
          ? "border-border bg-muted text-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{on ? "Ads are paused" : "Ads can run"}</p>
        {compact ? null : (
          <p className={cn("mt-0.5 text-xs leading-5", on ? "text-muted-foreground" : "text-destructive/80")}>
            {on
              ? "Nothing goes live while ads are paused. You stay in control of spend."
              : "Ads can run. Approve still needs a human and will change live ads."}
          </p>
        )}
      </div>
    </div>
  );
}

export function KillSwitchPill({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
        on
          ? "border-border bg-muted text-foreground"
          : "border-destructive/40 bg-destructive/15 text-destructive",
      )}
    >
      {on ? "Pause ads: on" : "Pause ads: off"}
    </span>
  );
}
