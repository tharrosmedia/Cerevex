export type GscDisplayRow = {
  query?: string | null;
  page?: string | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

export function gscQueryText(query?: string | null): string {
  const value = (query || '').trim();
  return value || '—';
}

/** Short path for the row. Full URL stays on title / wrap — never mid-string truncate. */
export function gscPagePath(page?: string | null): string {
  const raw = (page || '').trim();
  if (!raw) return '—';
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const path = `${url.pathname}${url.search}${url.hash}` || '/';
      return path === '' ? '/' : path;
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export function formatGscCtr(ctr?: number | null): string {
  if (ctr == null || Number.isNaN(Number(ctr))) return '—';
  return `${(Number(ctr) * 100).toFixed(1)}%`;
}

export function formatGscPosition(position?: number | null): string {
  if (position == null || Number.isNaN(Number(position))) return '—';
  return Number(position).toFixed(1);
}

/** Default Search Console sort: clicks desc, then impressions desc. */
export function sortGscRowsByClicks<T extends GscDisplayRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const clicks = (Number(b.clicks) || 0) - (Number(a.clicks) || 0);
    if (clicks !== 0) return clicks;
    return (Number(b.impressions) || 0) - (Number(a.impressions) || 0);
  });
}
