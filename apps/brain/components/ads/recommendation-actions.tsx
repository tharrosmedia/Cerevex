'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdsSuggestion } from '@/lib/ads-bff';
import {
  ADS_APPROVE_FROZEN,
  ADS_APPROVE_PAUSED,
  ADS_APPROVE_SOFT_LAUNCH,
  platformFromRecord,
  platformLabel,
  riskLabel,
} from '@/lib/ads-copy';

type Mutation = {
  action?: string;
  platform?: string;
  target?: { name?: string; entityType?: string; externalId?: string };
  payload?: Record<string, unknown>;
};

function mutationLine(mutation: Mutation): string {
  const name = mutation.target?.name ?? mutation.target?.externalId ?? 'this entity';
  const action = (mutation.action ?? 'change').replace(/[_-]+/g, ' ');
  const percent = typeof mutation.payload?.percent === 'number' ? ` by ${mutation.payload.percent}%` : '';
  return `${action} ${name}${percent}`;
}

export function RecommendationActions({
  suggestion,
  clientName,
  canApprove,
  killSwitchOn,
  frozen,
}: {
  suggestion: AdsSuggestion;
  clientName?: string;
  canApprove: boolean;
  killSwitchOn: boolean;
  frozen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const open = suggestion.status === 'proposed';
  const mutations = (suggestion.proposedMutations ?? []) as Mutation[];
  const entities = useMemo(
    () => [...new Set(mutations.map((row) => row.target?.name).filter((value): value is string => Boolean(value)))],
    [mutations],
  );

  function approveBlockReason(): string | null {
    if (!canApprove) return ADS_APPROVE_SOFT_LAUNCH;
    if (killSwitchOn) return ADS_APPROVE_PAUSED;
    if (frozen) return ADS_APPROVE_FROZEN;
    return null;
  }

  function onApprove() {
    const blocked = approveBlockReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    if (busy) {
      setError('Still saving the last decision.');
      return;
    }
    setError(null);
    setConfirm(true);
  }

  async function decide(action: 'approve' | 'deny' | 'snooze') {
    if (action === 'approve') {
      const blocked = approveBlockReason();
      if (blocked) {
        setError(blocked);
        return;
      }
    }
    if (busy) {
      setError('Still saving the last decision.');
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/ads/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recommendationId: suggestion.id, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; note?: string };
      if (!res.ok) {
        throw new Error(body.error ?? 'Could not save that decision.');
      }
      setNotice(body.note ?? (action === 'approve' ? 'Approved. Apply is queued.' : 'Saved. Nothing was written to Meta or Google.'));
      setConfirm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that decision.');
    } finally {
      setBusy(null);
    }
  }

  if (!open && !notice) return null;

  return (
    <div className="cx-panel">
      {notice ? <p className="cx-banner" role="status">{notice}</p> : null}
      {error ? <p className="cx-banner cx-banner-warn" role="alert">{error}</p> : null}
      {open ? (
        <div className="cx-actions">
          <button
            type="button"
            className="btn-cta"
            disabled={busy !== null}
            onClick={onApprove}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => decide('deny')}>
            {busy === 'deny' ? 'Saving…' : 'Deny'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => decide('snooze')}>
            {busy === 'snooze' ? 'Saving…' : 'Snooze'}
          </button>
        </div>
      ) : null}
      {!canApprove && open ? <p className="cx-help">{ADS_APPROVE_SOFT_LAUNCH}</p> : null}
      {confirm ? (
        <div className="cx-panel" role="dialog" aria-labelledby="approve-title">
          <h3 id="approve-title">
            {suggestion.type === 'budget_shift' ? 'Approve this budget shift?' : 'Approve this change?'}
          </h3>
          <p className="cx-help">
            {suggestion.type === 'budget_shift'
              ? 'This will change live budgets. Applying… starts after you confirm.'
              : suggestion.type === 'create_alternative'
                ? 'This will create a paused ad after Grok. Brainstorm did not write live.'
                : suggestion.type === 'lp_congruence' || suggestion.type === 'lp_intelligence'
                  ? 'This suggestion is recommend-only. Site apply later — nothing writes the website.'
                  : suggestion.type === 'creative_fatigue'
                    ? 'This is a refresh recommendation. Approve records the decision. Nothing creates a live ad from this card.'
                    : suggestion.type === 'search_negatives'
                      ? 'This will add Google negatives only when search-term hygiene is on. Deny and Snooze write nothing.'
                      : suggestion.type === 'geo_discipline'
                        ? 'This will record a service-area tighten only when geo discipline is on. Deny and Snooze write nothing.'
                        : suggestion.type === 'brand_guardrails'
                          ? 'This will pause or hold spend on a claim or brand risk. Unsupervised spend cannot pass this quietly.'
                  : 'This will change live ads.'}
          </p>
          <p className="cx-help">Client: {clientName ?? 'Unknown'}</p>
          <p className="cx-help">Platform: {platformLabel(platformFromRecord(suggestion.evidence))}</p>
          <p className="cx-help">Entities: {entities.join(', ') || 'See list'}</p>
          <ul>
            {mutations.map((mutation, index) => (
              <li key={`${suggestion.id}-m-${index}`}>{mutationLine(mutation)}</li>
            ))}
          </ul>
          <p className="cx-help">{riskLabel(suggestion.risk)}</p>
          <div className="cx-actions">
            <button type="button" className="btn-cta" disabled={busy !== null} onClick={() => decide('approve')}>
              {busy === 'approve'
                ? suggestion.type === 'budget_shift'
                  ? 'Applying…'
                  : 'Approving…'
                : 'Approve and apply'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
