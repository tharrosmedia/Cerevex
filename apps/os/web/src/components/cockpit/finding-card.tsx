import type { FindingPublic } from "@tharros/shared";
import { findingDetail } from "@/lib/format";
import { SeverityBadge } from "./status-badge";

export function FindingCard({ finding }: { finding: FindingPublic }) {
  const detail = findingDetail(finding.body);
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{finding.title}</p>
        <SeverityBadge severity={finding.severity} />
      </div>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </li>
  );
}
