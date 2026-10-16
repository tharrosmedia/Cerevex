import type { RemoteKillSwitch } from "./kill-switch";

/** Short cache so a denied flood does not read the ads API on every request. */
export function cacheRemoteKillSwitch(
  read: () => Promise<RemoteKillSwitch>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<RemoteKillSwitch> {
  if (ttlMs <= 0) return read;
  let cached: { value: RemoteKillSwitch; at: number } | null = null;
  let pending: Promise<RemoteKillSwitch> | null = null;
  return () => {
    const at = now();
    if (cached && at - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (!pending) {
      pending = read()
        .then((value) => {
          cached = { value, at: now() };
          pending = null;
          return value;
        })
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}
