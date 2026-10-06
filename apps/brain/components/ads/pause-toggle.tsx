import { adsApi } from '@/lib/ads-bff';
import { submitAdsPause } from '@/lib/ads-pause-action';
import { ADS_PAUSE_ACTION, ADS_TURN_ON_IN_ADS, pauseToggleView } from '@/lib/ads-pause';
import { ADS_OWNER_UNPAUSE_PATH, adsSafetySettingsHref } from '@/lib/module-origins';
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
  const view = pauseToggleView({ killSwitchOn: resolved });
  const adsOwnerHref = adsSafetySettingsHref() || ADS_OWNER_UNPAUSE_PATH;

  return (
    <div id="ads-pause" className="cx-panel" data-pause={view.known ? (view.paused ? 'on' : 'off') : 'unknown'}>
      <h2>Ads pause</h2>
      <p className="cx-help">
        Workspace kill switch. When pause is on, Approve cannot change live ads. The default is on. Brain only pauses.
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
      {view.showAdsTurnOn ? (
        <a className="btn-secondary text-sm" href={adsOwnerHref}>
          {ADS_TURN_ON_IN_ADS}
        </a>
      ) : null}
    </div>
  );
}
