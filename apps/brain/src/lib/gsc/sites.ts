export const GSC_SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';

export type GscSite = {
  siteUrl: string;
  permissionLevel?: string;
};

/** Parse Search Console `webmasters.sites.list` JSON into site URLs. */
export function parseGscSiteEntries(payload: unknown): GscSite[] {
  const entries = (payload as { siteEntry?: unknown })?.siteEntry;
  if (!Array.isArray(entries)) return [];
  const sites: GscSite[] = [];
  for (const entry of entries) {
    const siteUrl = typeof (entry as { siteUrl?: unknown })?.siteUrl === 'string'
      ? (entry as { siteUrl: string }).siteUrl.trim()
      : '';
    if (!siteUrl) continue;
    const permissionLevel = typeof (entry as { permissionLevel?: unknown })?.permissionLevel === 'string'
      ? (entry as { permissionLevel: string }).permissionLevel
      : undefined;
    sites.push({ siteUrl, permissionLevel });
  }
  return sites;
}

/** Dropdown values: listed GSC properties, plus a saved URL that is no longer in the list. */
export function mergeGscPropertyOptions(siteUrls: string[], current?: string | null): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (url?: string | null) => {
    const next = (url || '').trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    urls.push(next);
  };
  for (const url of siteUrls) add(url);
  if (current && !seen.has(current.trim())) {
    urls.unshift(current.trim());
  }
  return urls;
}

export function gscSitesEmptyCopy() {
  return 'This Google account has no Search Console properties. Confirm the account has access in Search Console, or reconnect with the Google account that owns the site.';
}

export function gscSitesErrorCopy() {
  return 'Could not load Search Console properties from Google. Paste the exact property below, or reconnect and try again.';
}

export function gscPropertyFallbackHelp() {
  return 'Paste the exact Search Console property (https://www.example.com/ or sc-domain:example.com).';
}

/** Call Search Console `webmasters.sites.list` with an existing access token. */
export async function fetchGscSites(accessToken: string): Promise<GscSite[]> {
  const res = await fetch(GSC_SITES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error('GSC sites.list failed: ' + await res.text());
  }
  return parseGscSiteEntries(await res.json());
}
