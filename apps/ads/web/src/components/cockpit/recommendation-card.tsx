import Link from "next/link";
import type { RecommendationPublic } from "@tharros/ads-shared";
import { summarizeMutation } from "@tharros/ads-shared";
import { Button } from "@/components/ui/button";
import { asProposedMutations, formatMoney, titleCase } from "@/lib/format";
import { RecStatusBadge, RiskBadge } from "./status-badge";

type Decision = "deny" | "snooze";

export function RecommendationCard({
  recommendation,
  canManage,
  canApprove,
  killSwitchOn,
  frozen,
  busy,
  onDecide,
  onApprove,
}: {
  recommendation: RecommendationPublic;
  canManage: boolean;
  canApprove: boolean;
  killSwitchOn: boolean;
  frozen?: boolean;
  busy: string | null;
  onDecide: (id: string, action: Decision) => void;
  onApprove?: (id: string) => void;
}) {
  const mutations = asProposedMutations(recommendation.proposedMutations);
  const impact = formatMoney(recommendation.estimatedImpactUsd);
  const deciding = busy === recommendation.id;
  const open = recommendation.status === "proposed";

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
              {summarizeMutation({
                action: mutation.action,
                platform: mutation.platform,
                target: { name: mutation.targetName },
                payload: mutation.payload,
              })}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/app/recommendations/${recommendation.id}`}
          className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
        >
          Open detail
        </Link>
        {canManage && open ? (
          <>
            <Button
              size="sm"
              onClick={() => (onApprove ? onApprove(recommendation.id) : undefined)}
              disabled={!canApprove || killSwitchOn || frozen || deciding}
            >
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDecide(recommendation.id, "deny")} disabled={deciding}>
              Deny
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDecide(recommendation.id, "snooze")} disabled={deciding}>
              Snooze
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
