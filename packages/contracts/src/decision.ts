/**
 * Shared decision envelope (v0).
 *
 * Lifecycle: propose → human decide → optional execute.
 * Execute is never unsupervised. OS apply and Brain publish both require a grant.
 */

/** OS apply language. */
export const OS_DECISION_ACTIONS = ["authorize", "deny", "snooze"] as const;
export type OsDecisionAction = (typeof OS_DECISION_ACTIONS)[number];

/** Brain publish language. */
export const BRAIN_DECISION_ACTIONS = ["approve", "reject", "snooze"] as const;
export type BrainDecisionAction = (typeof BRAIN_DECISION_ACTIONS)[number];

/**
 * Common union. Product notes:
 * - `authorize` (OS) ≡ `approve` (Brain publish)
 * - `deny` (OS) ≡ `reject` (Brain publish)
 * - `snooze` is the same in both products
 */
export type DecisionAction = OsDecisionAction | BrainDecisionAction;

export const DECISION_ACTION_MAP = {
  authorize: "approve",
  approve: "authorize",
  deny: "reject",
  reject: "deny",
  snooze: "snooze",
} as const satisfies Record<DecisionAction, DecisionAction>;

export type DecisionStage = "propose" | "decide" | "execute";

export type DecisionRecord = {
  id: string;
  workspaceId: string;
  clientId?: string | null;
  recommendationId: string;
  userId: string;
  action: DecisionAction;
  source: "os" | "brain";
  note?: string | null;
  createdAt: string;
};

/** @deprecated Use DecisionRecord. Kept as Origin alias. */
export type DecisionEnvelope = DecisionRecord;

export function toOsDecisionAction(action: DecisionAction): OsDecisionAction {
  if (action === "approve") return "authorize";
  if (action === "reject") return "deny";
  return action;
}

export function toBrainDecisionAction(action: DecisionAction): BrainDecisionAction {
  if (action === "authorize") return "approve";
  if (action === "deny") return "reject";
  return action;
}
