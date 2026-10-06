import { authorizeApproveSession, internalKeyMatches, passwordMatches, type CredentialSource } from './sensitive-auth';
import { isProductionRuntime } from './runtime-env';

const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADS_PAUSE_ON_LABEL = 'Paused';
export const ADS_PAUSE_OFF_LABEL = 'On';
export const ADS_PAUSE_ON_STATUS = 'Ads are paused. Nothing goes live.';
export const ADS_PAUSE_OFF_STATUS = 'Ads can run. Approve still needs a person before anything changes.';
export const ADS_PAUSE_UNKNOWN_STATUS = 'Pause status did not load. Ads stay paused until this page can read the workspace.';
export const ADS_PAUSE_ACTION = 'Pause ads';
export const ADS_TURN_ON_IN_ADS = 'Turn on in Ads';
export const ADS_PAUSE_SAVED_ON = 'Ads are paused. Nothing goes live.';
export const BRAIN_PAUSE_ONLY = 'brain_pause_only';
export const BRAIN_PAUSE_ONLY_ERROR = 'Turn pause off in Ads. Brain only pauses.';

export type PauseCaller = 'anonymous' | 'service' | 'session' | 'owner';

export type PauseDecision =
  | { ok: true; applyKillSwitch: true; workspaceId: string }
  | { ok: false; status: 400 | 401 | 403; error: string; code?: string };

export function boundWorkspaceId(raw: string | null | undefined = process.env.ADS_INTERNAL_WORKSPACE_ID): string | null {
  const value = raw?.trim() ?? '';
  return WORKSPACE_UUID.test(value) ? value : null;
}

function hasConsoleSession(creds: CredentialSource): boolean {
  if (!process.env.APP_PASSWORD) return false;
  return passwordMatches(creds.cookie);
}

/**
 * Owner is a real approve-operator console session only.
 * Dev-open and the service key are never the owner. Same rule as approve.
 */
export function pauseCaller(creds: CredentialSource): PauseCaller {
  if (authorizeApproveSession(creds).ok) return 'owner';
  if (hasConsoleSession(creds)) return 'session';
  if (internalKeyMatches(creds.internalKey)) return 'service';
  if (!process.env.APP_PASSWORD && !isProductionRuntime()) return 'session';
  return 'anonymous';
}

/**
 * Brain only pauses. applyKillSwitch false is refused for every caller and writes nothing.
 * Pause is one step for anyone who can already call this route.
 */
export function decideAdsPause(input: {
  caller: PauseCaller;
  applyKillSwitch: unknown;
  requestedWorkspaceId?: unknown;
  boundWorkspaceId: string | null;
}): PauseDecision {
  if (input.applyKillSwitch === false) {
    return { ok: false, status: 403, error: BRAIN_PAUSE_ONLY_ERROR, code: BRAIN_PAUSE_ONLY };
  }
  if (input.caller === 'anonymous') {
    return { ok: false, status: 401, error: 'Sign in required' };
  }
  if (input.applyKillSwitch !== true) {
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
  return { ok: true, applyKillSwitch: true, workspaceId: input.boundWorkspaceId };
}

export type PauseToggleView = {
  known: boolean;
  paused: boolean;
  stateLabel: string;
  status: string;
  showPause: boolean;
  showAdsTurnOn: boolean;
};

/** Unknown status renders as paused and offers no Brain button, so the page cannot turn apply on by guess. */
export function pauseToggleView(input: { killSwitchOn: boolean | null }): PauseToggleView {
  if (input.killSwitchOn == null) {
    return {
      known: false,
      paused: true,
      stateLabel: ADS_PAUSE_ON_LABEL,
      status: ADS_PAUSE_UNKNOWN_STATUS,
      showPause: false,
      showAdsTurnOn: true,
    };
  }
  if (input.killSwitchOn) {
    return {
      known: true,
      paused: true,
      stateLabel: ADS_PAUSE_ON_LABEL,
      status: ADS_PAUSE_ON_STATUS,
      showPause: false,
      showAdsTurnOn: true,
    };
  }
  return {
    known: true,
    paused: false,
    stateLabel: ADS_PAUSE_OFF_LABEL,
    status: ADS_PAUSE_OFF_STATUS,
    showPause: true,
    showAdsTurnOn: false,
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
