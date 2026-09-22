/**
 * Decision / authorization envelopes (Plan 1.5).
 *
 * Two distinct gates — do not collapse them:
 * - OS `authorize-to-apply`: OS decides whether a proposed write may be applied.
 * - Brain `approve-to-publish`: Brain human-in-the-loop for SEO/content publish.
 *
 * Do not bolt OS RBAC onto Brain APP_PASSWORD. OS auth stays separate week one.
 */

export type DecisionVerdict = "authorized" | "denied" | "needs_review";
export type PublishVerdict = "approved" | "rejected" | "edited";

export interface ResourceRef {
  type: string;
  id: string;
}

/**
 * OS authorize-to-apply.
 * OS owns this envelope. Brain does not evaluate OS RBAC.
 */
export interface AuthorizeToApplyEnvelope {
  kind: "os.authorize-to-apply";
  decisionId: string;
  clientId: string;
  actor: string;
  action: string;
  resource: ResourceRef;
  verdict: DecisionVerdict;
  reason?: string;
  createdAt: string;
}

/**
 * Brain approve-to-publish.
 * Existing SEO approval path (human-in-the-loop). Store-scoped.
 */
export interface ApproveToPublishEnvelope {
  kind: "brain.approve-to-publish";
  decisionId: string;
  storeId: string;
  jobId: string;
  actor: string;
  verdict: PublishVerdict;
  draftId?: string;
  reviewerNotes?: string;
  createdAt: string;
}

export type AuthorizationKindEnvelope = AuthorizeToApplyEnvelope | ApproveToPublishEnvelope;
/** @deprecated Use AuthorizationKindEnvelope. */
export type DecisionKindEnvelope = AuthorizationKindEnvelope;
