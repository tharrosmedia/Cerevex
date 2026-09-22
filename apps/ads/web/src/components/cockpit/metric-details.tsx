import type { ReactNode } from "react";

export function MetricDetails({
  children,
  label = "Details",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none text-foreground/80 hover:text-foreground">
        {label}
      </summary>
      <div className="mt-1.5 leading-5">{children}</div>
    </details>
  );
}
