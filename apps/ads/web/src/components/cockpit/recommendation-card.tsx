import type { RecommendationPublic } from "@tharros/ads-shared";
import { Button } from "@/components/ui/button";
import { asProposedMutations, formatMoney, titleCase } from "@/lib/format";
import { RecStatusBadge, RiskBadge } from "./status-badge";

type Decision = "authorize" | "deny" | "snooze";

export function RecommendationCard({
  recommendation,
  canManage,
  killSwitchOn,
  busy,
  onDecide,
  onApply,
}: {
  recommendation: RecommendationPublic;
  canManage: boolean;
  killSwitchOn: boolean;
  busy: string | null;
  onDecide: (id: string, action: Decision) => void;
  onApply: (id: string) => void;
}) {
  const mutations = asProposedMutations(recommendation.proposedMutations);
  const impact = formatMoney(recommendation.estimatedImpactUsd);
  const deciding = busy === recommendation.id;
  const applying = busy === `apply-${recommendation.id}`;

  return (
    <li className="rounded-md border border-border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{recommendation.title}</p>
          <p className="mt-1 text-muted-foreground">{recommendation.rationale}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {titleCase(recommendation.type)}
            {impact ? ` · est. ${impact}` : ""}
            {recommendation.confidence ? ` · confidence ${recommendation.confidence}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <RecStatusBadge status={recommendation.status} />
          <RiskBadge risk={recommendation.risk} />
        </div>
      </div>

      {mutations.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {mutations.map((mutation, index) => (
            <li key={`${recommendation.id}-m-${index}`}>
              Proposed {mutation.action ?? "change"}
              {mutation.targetName ? ` on ${mutation.targetName}` : ""}
              {mutation.platform ? ` (${mutation.platform})` : ""}
              {" · "}
              execute {mutation.execute ? "true" : "false"}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage && recommendation.status === "proposed" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide(recommendation.id, "authorize")} disabled={deciding}>
            {deciding ? "Saving…" : "Authorize"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecide(recommendation.id, "deny")}
            disabled={deciding}
          >
            Deny
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDecide(recommendation.id, "snooze")}
            disabled={deciding}
          >
            Snooze
          </Button>
        </div>
      ) : null}

      {canManage && recommendation.status === "authorized" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApply(recommendation.id)}
            disabled={applying || killSwitchOn}
          >
            {applying
              ? "Checking apply gate…"
              : killSwitchOn
                ? "Apply blocked (kill switch ON)"
                : "Request apply"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Authorization is recorded only. Apply is a separate step
            {killSwitchOn ? " and stays blocked while the kill switch is on." : "."} No Meta/Google writes.
          </p>
        </div>
      ) : null}
    </li>
  );
}
