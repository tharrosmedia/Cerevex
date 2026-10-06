import { canApproveApply } from '@cerevex/contracts';
import { adsApi } from '@/lib/ads-bff';
import { submitAdsPause } from '@/lib/ads-pause-action';
import {
  ADS_PAUSE_ACTION,
  ADS_PAUSE_CONFIRM_CHECK,
  ADS_PAUSE_CONFIRM_COPY,
  ADS_PAUSE_OWNER_ONLY,
  ADS_UNPAUSE_ACTION,
  pauseToggleView,
} from '@/lib/ads-pause';
import { consoleOperatorEmail } from '@/lib/sensitive-auth';
import { SubmitButton } from '@/components/submit-button';

async function displayedKillSwitch(): Promise<boolean | null> {
  try {
    const result = await Promise.race([
      adsApi<{ workspace: { applyKillSwitch?: boolean } | null }>('/workspace'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (!result?.ok || !result.data.workspace) return null;
    return result.data.workspace.applyKillSwitch !== false;
  } catch {
    return null;
  }
}

export async function AdsPauseToggle({
  killSwitchOn,
  returnTo = '/settings#ads-pause',
}: {
  /** Pass false only when ads reported the kill switch off. Omit to read it here. */
  killSwitchOn?: boolean | null;
  returnTo?: string;
}) {
  const resolved = killSwitchOn === undefined ? await displayedKillSwitch() : killSwitchOn;
  const view = pauseToggleView({
    killSwitchOn: resolved,
    owner: canApproveApply(consoleOperatorEmail()),
  });

  return (
    <div id="ads-pause" className="cx-panel" data-pause={view.known ? (view.paused ? 'on' : 'off') : 'unknown'}>
      <h2>Ads pause</h2>
      <p className="cx-help">
        Workspace kill switch. When pause is on, Approve cannot change live ads. The default is on.
      </p>
      <p role="status" data-pause-state={view.known ? (view.paused ? 'on' : 'off') : 'unknown'}>
        <strong>{view.stateLabel}</strong>. {view.status}
      </p>
      {view.showPause ? (
        <form action={submitAdsPause}>
          <input type="hidden" name="applyKillSwitch" value="true" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="btn-secondary" pendingLabel="Pausing…">
            {ADS_PAUSE_ACTION}
          </SubmitButton>
        </form>
      ) : null}
      {view.showUnpause ? (
        <form action={submitAdsPause} className="cx-form">
          <p className="cx-help">{ADS_PAUSE_CONFIRM_COPY}</p>
          <label className="cx-field">
            <span>
              <input type="checkbox" name="confirm" value="true" required /> {ADS_PAUSE_CONFIRM_CHECK}
            </span>
          </label>
          <input type="hidden" name="applyKillSwitch" value="false" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="btn-cta" pendingLabel="Turning pause off…">
            {ADS_UNPAUSE_ACTION}
          </SubmitButton>
        </form>
      ) : null}
      {view.showOwnerNote ? <p className="cx-help">{ADS_PAUSE_OWNER_ONLY}</p> : null}
    </div>
  );
}
