export const GSC_DEFAULT_POSITION_THRESHOLD = 3;
export const GSC_MIN_POSITION_THRESHOLD = 1;
export const GSC_MAX_POSITION_THRESHOLD = 20;

export function parsePositionThreshold(raw: unknown, fallback = GSC_DEFAULT_POSITION_THRESHOLD): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(GSC_MAX_POSITION_THRESHOLD, Math.max(GSC_MIN_POSITION_THRESHOLD, n));
  return Math.round(clamped * 10) / 10;
}

export function gscConfigFromStore(store: { config?: Record<string, unknown> } | null | undefined): Record<string, unknown> {
  const config = store?.config && typeof store.config === 'object' && !Array.isArray(store.config)
    ? store.config as Record<string, unknown>
    : {};
  const gsc = config.gsc;
  if (gsc && typeof gsc === 'object' && !Array.isArray(gsc)) return gsc as Record<string, unknown>;
  return {};
}

export function positionThresholdFromStore(store: { config?: Record<string, unknown> } | null | undefined): number {
  return parsePositionThreshold(gscConfigFromStore(store).positionThreshold);
}

/** Kill switch defaults ON. Only an explicit false allows apply. */
export function gscApplyKillSwitchIsOn(value: unknown): boolean {
  return value !== false;
}

export function gscApplyBlockedByKillSwitch(store: { config?: Record<string, unknown> } | null | undefined): boolean {
  return gscApplyKillSwitchIsOn(gscConfigFromStore(store).applyKillSwitch);
}

export function withGscStoreConfig(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const gsc = gscConfigFromStore({ config: current });
  return { ...current, gsc: { ...gsc, ...patch } };
}
