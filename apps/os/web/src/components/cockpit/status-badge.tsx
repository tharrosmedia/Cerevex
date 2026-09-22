import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

function severityVariant(severity: string): "destructive" | "secondary" | "outline" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "secondary";
  return "outline";
}

function recVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "authorized") return "default";
  if (status === "denied") return "destructive";
  if (status === "snoozed") return "secondary";
  return "outline";
}

function connectionVariant(status: string): "destructive" | "secondary" | "outline" {
  if (status === "error") return "destructive";
  if (status === "connected") return "secondary";
  return "outline";
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={severityVariant(severity)} className="capitalize">
      {severity}
    </Badge>
  );
}

export function RecStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={recVariant(status)} className="capitalize">
      {titleCase(status)}
    </Badge>
  );
}

export function ConnectionBadge({
  status,
  mock,
}: {
  status: string;
  mock?: boolean;
}) {
  return (
    <Badge variant={connectionVariant(status)} className="capitalize">
      {status}
      {mock ? " · mock" : ""}
    </Badge>
  );
}

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <Badge variant={risk === "high" ? "destructive" : "outline"} className="capitalize">
      Risk {risk}
    </Badge>
  );
}
