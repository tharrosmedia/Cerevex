import { canApproveApply } from '@cerevex/contracts';
import { consoleOperatorEmail, internalKeyMatches, passwordMatches, type CredentialSource } from './sensitive-auth';
import { isProductionRuntime } from './runtime-env';

const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADS_PAUSE_ON_LABEL = 'Paused';
export const ADS_PAUSE_OFF_LABEL = 'On';
export const ADS_PAUSE_ON_STATUS = 'Ads are paused. Nothing goes live.';
export const ADS_PAUSE_OFF_STATUS = 'Ads can run. Approve still needs a person before anything changes.';
export const ADS_PAUSE_UNKNOWN_STATUS = 'Pause status did not load. Ads stay paused until this page can read the workspace.';
export const ADS_PAUSE_CONFIRM_COPY =
  'Turn pause off? Approve can then change live ads. This does not spend money by itself. Each change still needs a person to Approve.';
export const ADS_PAUSE_CONFIRM_CHECK = 'Yes, Approve can change live ads after this.';
export const ADS_PAUSE_OWNER_ONLY = 'Only the workspace owner can turn pause off.';
export const ADS_PAUSE_ACTION = 'Pause ads';
export const ADS_UNPAUSE_ACTION = 'Turn pause off';
export const ADS_PAUSE_SAVED_ON = 'Ads are paused. Nothing goes live.';
export const ADS_PAUSE_SAVED_OFF = 'Pause is off. Approve can change live ads. Each change still needs a person.';

export type PauseCaller = 'anonymous' | 'service' | 'session' | 'owner';

export type PauseDecision =
  | { ok: true; applyKillSwitch: boolean; workspaceId: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

export function boundWorkspaceId(raw: string | null | undefined = process.env.ADS_INTERNAL_WORKSPACE_ID): string | null {
  const value = raw?.trim() ?? '';
  return WORKSPACE_UUID.test(value) ? value : null;
}

function hasConsoleSession(creds: CredentialSource): boolean {
  if (!process.env.APP_PASSWORD) return false;
  return passwordMatches(creds.cookie);
}

/** Console session of the approve operator counts as the owner. The service key never does. */
export function pauseCaller(creds: CredentialSource): PauseCaller {
  if (hasConsoleSession(creds) || (!process.env.APP_PASSWORD && !isProductionRuntime())) {
    return canApproveApply(consoleOperatorEmail()) ? 'owner' : 'session';
  }
  if (internalKeyMatches(creds.internalKey)) return 'service';
  return 'anonymous';
}

/**
 * Pause (kill switch on) is one step for anyone who can already call this route.
 * Turning pause off needs the workspace owner (approve operator) and confirm: true.
 * The service key cannot turn pause off. A workspace id other than this site is refused.
 */
export function decideAdsPause(input: {
  caller: PauseCaller;
  applyKillSwitch: unknown;
  confirm: unknown;
  requestedWorkspaceId?: unknown;
  boundWorkspaceId: string | null;
}): PauseDecision {
  if (input.caller === 'anonymous') {
    return { ok: false, status: 401, error: 'Sign in required' };
  }
  if (typeof input.applyKillSwitch !== 'boolean') {
    return { ok: false, status: 400, error: 'Say whether ads should be paused.' };
  }
  if (!input.boundWorkspaceId) {
    return { ok: false, status: 403, error: 'This site is not tied to a workspace.' };
  }
  if (input.requestedWorkspaceId != null && input.requestedWorkspaceId !== '') {
    if (input.requestedWorkspaceId !== input.boundWorkspaceId) {
      return { ok: false, status: 403, error: 'That workspace is not this site.' };
    }
  }
  if (input.applyKillSwitch === false) {
    if (input.caller === 'service') {
      return { ok: false, status: 403, error: 'The service key cannot turn pause off.' };
    }
    if (input.caller !== 'owner') {
      return { ok: false, status: 403, error: ADS_PAUSE_OWNER_ONLY };
    }
    if (input.confirm !== true) {
      return { ok: false, status: 400, error: 'Confirm turning pause off before Approve can change live ads.' };
    }
  }
  return { ok: true, applyKillSwitch: input.applyKillSwitch, workspaceId: input.boundWorkspaceId };
}

export type PauseToggleView = {
  known: boolean;
  paused: boolean;
  stateLabel: string;
  status: string;
  showPause: boolean;
  showUnpause: boolean;
  showOwnerNote: boolean;
};

/** Unknown status renders as paused and offers no button, so the page cannot turn apply on by guess. */
export function pauseToggleView(input: { killSwitchOn: boolean | null; owner: boolean }): PauseToggleView {
  if (input.killSwitchOn == null) {
    return {
      known: false,
      paused: true,
      stateLabel: ADS_PAUSE_ON_LABEL,
      status: ADS_PAUSE_UNKNOWN_STATUS,
      showPause: false,
      showUnpause: false,
      showOwnerNote: false,
    };
  }
  if (input.killSwitchOn) {
    return {
      known: true,
      paused: true,
      stateLabel: ADS_PAUSE_ON_LABEL,
      status: ADS_PAUSE_ON_STATUS,
      showPause: false,
      showUnpause: input.owner,
      showOwnerNote: !input.owner,
    };
  }
  return {
    known: true,
    paused: false,
    stateLabel: ADS_PAUSE_OFF_LABEL,
    status: ADS_PAUSE_OFF_STATUS,
    showPause: true,
    showUnpause: false,
    showOwnerNote: false,
  };
}

export function safePauseReturn(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('://') || trimmed.includes('\\')) {
    return '/settings#ads-pause';
  }
  const path = trimmed.split(/[?#]/)[0] ?? '';
  if (path === '/settings' || path === '/ads' || path.startsWith('/ads/')) return trimmed;
  return '/settings#ads-pause';
}

export function pauseReturnWithNotice(returnTo: string, query: string): string {
  const safe = safePauseReturn(returnTo);
  const hashAt = safe.indexOf('#');
  const hash = hashAt >= 0 ? safe.slice(hashAt) : '';
  const before = hashAt >= 0 ? safe.slice(0, hashAt) : safe;
  const joiner = before.includes('?') ? '&' : '?';
  return `${before}${joiner}${query}${hash}`;
}
