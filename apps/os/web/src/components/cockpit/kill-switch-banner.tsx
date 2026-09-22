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
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          Apply kill switch {on ? "ON" : "OFF"}
        </p>
        {compact ? null : (
          <p className={cn("mt-0.5 text-xs leading-5", on ? "text-primary/80" : "text-destructive/80")}>
            {on
              ? "Authorize ≠ apply. Apply stays blocked. No Meta/Google writes and no unsupervised spend."
              : "Kill switch is off in this workspace. Apply is still a separate step and must never write platforms unsupervised."}
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
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-destructive/40 bg-destructive/15 text-destructive",
      )}
    >
      Kill switch {on ? "ON" : "OFF"}
    </span>
  );
}
